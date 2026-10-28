// @vitest-environment jsdom
// 会话记录按画布分区（画布库 spec §6，票 ①05）：
// - 新建/切到别的画布后，旧画布的气泡不再出现；
// - 本会话内切回旧画布，能看到属于它的消息；
// - AI 回复进行中切走画布：中断在飞请求，并把「已取消」记回发起时那张画布的桶。
import type { CanvasDocument } from '@paintcodex/protocol';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiChatPanel } from '../src/features/ai-chat/AiChatPanel';
import { useChatStore } from '../src/features/ai-chat/chat-store';
import { useCanvasStore } from '../src/services/canvas-store';

function readyCanvas(id: string): CanvasDocument {
  return {
    id,
    name: '测试画布',
    width: 1920,
    height: 1080,
    backgroundColor: '#ffffff',
    revision: 1,
    createdAt: 0,
    updatedAt: 0,
    history: { canUndo: false, canRedo: false },
    layers: [],
  };
}

const encoder = new TextEncoder();

function controlledStream() {
  let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
    },
  });

  return {
    body,
    push(payload: unknown) {
      streamController?.enqueue(
        encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
      );
    },
    fail(error: unknown) {
      streamController?.error(error);
    },
    close() {
      streamController?.close();
    },
  };
}

function okResponse(body: ReadableStream<Uint8Array>): Response {
  return { ok: true, status: 200, body } as unknown as Response;
}

async function sendMessage(text: string): Promise<void> {
  fireEvent.change(screen.getByPlaceholderText('描述你想画的内容…'), {
    target: { value: text },
  });
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
  await screen.findByText(text);
}

/** 直接切换当前画布（模拟新建/从画布库打开另一张）。 */
function switchCanvas(id: string): void {
  useCanvasStore.setState({
    canvas: readyCanvas(id),
    status: 'ready',
    error: null,
    requestedCanvasId: id,
  });
}

beforeEach(() => {
  Object.defineProperty(Element.prototype, 'scrollTo', {
    configurable: true,
    value: () => undefined,
  });
  useChatStore.setState({ transcripts: {} });
  useCanvasStore.setState({
    canvas: readyCanvas('canvas-1'),
    status: 'ready',
    error: null,
    requestedCanvasId: 'canvas-1',
    saving: false,
    activeLayerId: null,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useChatStore.setState({ transcripts: {} });
  useCanvasStore.setState({
    canvas: null,
    status: 'idle',
    error: null,
    requestedCanvasId: null,
    saving: false,
    activeLayerId: null,
  });
});

describe('AiChatPanel 会话按画布分区', () => {
  it('切到新画布后旧消息不可见，切回本会话旧画布又可见', async () => {
    const stream = controlledStream();
    vi.stubGlobal('fetch', vi.fn(async () => okResponse(stream.body)));

    render(<AiChatPanel />);
    await sendMessage('画一只猫');
    expect(screen.getByText('画一只猫')).toBeTruthy();

    stream.push({ done: true });
    stream.close();
    expect(await screen.findByRole('button', { name: '发送' })).toBeTruthy();

    switchCanvas('canvas-2');

    // 新画布是空会话：旧气泡不再出现。
    await waitFor(() => expect(screen.queryByText('画一只猫')).toBeNull());
    expect(screen.getByText('向绘画助手咨询构图、配色，或者下一步该画什么。')).toBeTruthy();

    switchCanvas('canvas-1');

    // 本会话内切回：属于它的消息原封不动。
    expect(await screen.findByText('画一只猫')).toBeTruthy();
  });

  it('AI 回复进行中切走画布：abort 被调用，「已取消」记回发起时那张画布', async () => {
    const stream = controlledStream();
    let aborted = false;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        init?.signal?.addEventListener(
          'abort',
          () => {
            aborted = true;
            stream.fail(new DOMException('The operation was aborted.', 'AbortError'));
          },
          { once: true },
        );
        return okResponse(stream.body);
      }),
    );

    render(<AiChatPanel />);
    await sendMessage('画一只狗');
    // 回复进行中：发送按钮变成取消。
    expect(screen.queryByRole('button', { name: '发送' })).toBeNull();

    switchCanvas('canvas-2');

    await waitFor(() => expect(aborted).toBe(true));

    // 「已取消」追加在发起时那张画布（canvas-1）的桶里，而不是新画布。
    await waitFor(() => {
      const origin = useChatStore.getState().transcripts['canvas-1'] ?? [];
      expect(origin.some((message) => message.cancelled === true)).toBe(true);
    });
    const fresh = useChatStore.getState().transcripts['canvas-2'] ?? [];
    expect(fresh).toEqual([]);

    // 新画布界面上看不到旧消息，输入恢复可用。
    await waitFor(() => expect(screen.queryByText('画一只狗')).toBeNull());
    expect(await screen.findByRole('button', { name: '发送' })).toBeTruthy();
  });
});

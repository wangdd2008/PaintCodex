// @vitest-environment jsdom
import type { CanvasDocument } from '@paintcodex/protocol';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiChatPanel } from '../src/features/ai-chat/AiChatPanel';
import { useChatStore } from '../src/features/ai-chat/chat-store';
import { useCanvasStore } from '../src/services/canvas-store';

function readyCanvas(): CanvasDocument {
  return {
    id: 'canvas-1',
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

/** 由测试逐帧驱动的流，便于观察中间状态。 */
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
    close() {
      streamController?.close();
    },
  };
}

function okResponse(body: ReadableStream<Uint8Array>): Response {
  return { ok: true, status: 200, body } as unknown as Response;
}

function stubFetch(body: ReadableStream<Uint8Array>): void {
  vi.stubGlobal('fetch', vi.fn(async () => okResponse(body)));
}

async function sendMessage(text: string): Promise<void> {
  fireEvent.change(screen.getByPlaceholderText('描述你想画的内容…'), {
    target: { value: text },
  });
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
  await screen.findByText(text);
}

beforeEach(() => {
  Object.defineProperty(Element.prototype, 'scrollTo', {
    configurable: true,
    value: () => undefined,
  });
  useCanvasStore.setState({
    canvas: readyCanvas(),
    status: 'ready',
    error: null,
    requestedCanvasId: 'canvas-1',
    saving: false,
    activeLayerId: null,
  });
  // 会话记录现在是模块级 store，每个用例从空桶开始。
  useChatStore.setState({ transcripts: {} });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useCanvasStore.setState({
    canvas: null,
    status: 'idle',
    error: null,
    requestedCanvasId: null,
    saving: false,
    activeLayerId: null,
  });
});

describe('AiChatPanel 写操作行', () => {
  it('把写工具渲染成行，running 变 ok 时复用同一行', async () => {
    const stream = controlledStream();
    stubFetch(stream.body);
    render(<AiChatPanel />);

    await sendMessage('把红圆放大');
    stream.push({
      tool: { id: 'call-1', name: 'canvas_update_layer', status: 'running' },
    });
    expect(await screen.findByText('正在改写图层…')).toBeTruthy();

    stream.push({
      tool: { id: 'call-1', name: 'canvas_update_layer', status: 'ok' },
    });
    expect(await screen.findByText('已改写图层')).toBeTruthy();
    expect(screen.queryByText('正在改写图层…')).toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('失败行显示本地化后的错误码文案，不把原始码上屏', async () => {
    const stream = controlledStream();
    stubFetch(stream.body);
    render(<AiChatPanel />);

    await sendMessage('删掉那个图层');
    stream.push({
      tool: {
        id: 'call-2',
        name: 'canvas_delete_layer',
        status: 'failed',
        code: 'revision_conflict',
      },
    });

    expect(
      await screen.findByText('删除图层失败：画布已被改动，未覆盖最新内容'),
    ).toBeTruthy();
    expect(screen.queryByText(/revision_conflict/)).toBeNull();
  });

  it('折叠读工具，只留下写操作行', async () => {
    const stream = controlledStream();
    stubFetch(stream.body);
    render(<AiChatPanel />);

    await sendMessage('读一下画布再画');
    stream.push({
      tool: { id: 'call-3', name: 'canvas_get_context', status: 'running' },
    });
    stream.push({
      tool: { id: 'call-4', name: 'canvas_select', status: 'ok' },
    });
    stream.push({
      tool: { id: 'call-5', name: 'canvas_create_layer', status: 'ok' },
    });

    expect(await screen.findByText('已添加图层')).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.queryByText(/读取画布|选中图层/)).toBeNull();
  });
});

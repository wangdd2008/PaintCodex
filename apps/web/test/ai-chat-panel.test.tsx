// @vitest-environment jsdom
import type { CanvasDocument } from '@paintcodex/protocol';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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

/** A stream the test drives frame by frame, so intermediate states are observable. */
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

function stubFetch(body: ReadableStream<Uint8Array>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => okResponse(body)),
  );
}

async function sendMessage(text: string): Promise<void> {
  fireEvent.change(screen.getByPlaceholderText('描述你想画的内容…'), {
    target: { value: text },
  });
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
  // Yield so the request starts and the first frames are consumed.
  await screen.findByText(text);
}

beforeEach(() => {
  // jsdom does not implement element scrolling.
  Object.defineProperty(Element.prototype, 'scrollTo', {
    configurable: true,
    value: () => undefined,
  });
  // Composer tests assume a loaded canvas; the no-canvas gate has its own test.
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

describe('AiChatPanel clear input', () => {
  it('offers the clear action only when the draft has content', () => {
    render(<AiChatPanel />);

    expect(screen.queryByRole('button', { name: '清空' })).toBeNull();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'a red sky' } });

    expect(screen.getByRole('button', { name: '清空' })).toBeTruthy();
  });

  it('clears the draft and switches to undo', () => {
    render(<AiChatPanel />);
    const input = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'a red sky' } });

    fireEvent.click(screen.getByRole('button', { name: '清空' }));

    expect(input.value).toBe('');
    expect(screen.getByRole('button', { name: '撤销' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '清空' })).toBeNull();
  });

  it('restores the cleared draft once', () => {
    render(<AiChatPanel />);
    const input = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'a red sky' } });
    fireEvent.click(screen.getByRole('button', { name: '清空' }));

    fireEvent.click(screen.getByRole('button', { name: '撤销' }));

    expect(input.value).toBe('a red sky');
    expect(screen.queryByRole('button', { name: '撤销' })).toBeNull();
    expect(screen.getByRole('button', { name: '清空' })).toBeTruthy();
  });

  it('drops the undo offer as soon as the user types a new draft', () => {
    render(<AiChatPanel />);
    const input = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'a red sky' } });
    fireEvent.click(screen.getByRole('button', { name: '清空' }));

    fireEvent.change(input, { target: { value: 'a blue sea' } });

    expect(input.value).toBe('a blue sea');
    expect(screen.getByRole('button', { name: '清空' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '撤销' })).toBeNull();
  });

  it('leaves no undo offer once the next message is sent', async () => {
    const stream = controlledStream();
    stubFetch(stream.body);
    render(<AiChatPanel />);
    const input = screen.getByRole('textbox') as HTMLTextAreaElement;

    fireEvent.change(input, { target: { value: 'draft that was cleared' } });
    fireEvent.click(screen.getByRole('button', { name: '清空' }));

    fireEvent.change(input, { target: { value: 'second message' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    expect(await screen.findByText('second message')).toBeTruthy();

    stream.push({ done: true });
    stream.close();

    expect(await screen.findByRole('button', { name: '发送' })).toBeTruthy();
    expect(input.value).toBe('');
    expect(screen.queryByRole('button', { name: '撤销' })).toBeNull();
  });

  it('leaves the sent conversation untouched', async () => {
    const stream = controlledStream();
    stubFetch(stream.body);
    render(<AiChatPanel />);
    const input = screen.getByRole('textbox') as HTMLTextAreaElement;

    fireEvent.change(input, { target: { value: 'first message' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    expect(await screen.findByText('first message')).toBeTruthy();

    stream.push({ done: true });
    stream.close();
    expect(await screen.findByRole('button', { name: '发送' })).toBeTruthy();

    fireEvent.change(input, { target: { value: 'draft to clear' } });
    fireEvent.click(screen.getByRole('button', { name: '清空' }));
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));

    expect(screen.getByText('first message')).toBeTruthy();
  });
});

describe('AiChatPanel cancel', () => {
  it('replaces 发送 with 取消, aborts the request and marks the bubble 已取消', async () => {
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
    await sendMessage('Paint a cat');

    expect(screen.queryByRole('button', { name: '发送' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    expect(await screen.findByText('已取消')).toBeTruthy();
    expect(aborted).toBe(true);
    // Cancelling is a user action, not a failure.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: '发送' })).toBeTruthy();
  });
});

describe('AiChatPanel 无画布门禁', () => {
  it('无画布时禁用输入并说明原因，不发出请求', () => {
    useCanvasStore.setState({
      canvas: null,
      status: 'idle',
      error: null,
      requestedCanvasId: null,
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<AiChatPanel />);

    expect((screen.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(true);
    expect(screen.getByText('先新建一张画布，再让 AI 作画。')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: '发送' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('加载失败时禁用输入并指向重试或新建', () => {
    useCanvasStore.setState({
      canvas: null,
      status: 'error',
      error: 'Failed to fetch',
      requestedCanvasId: 'canvas-1',
    });

    render(<AiChatPanel />);

    expect((screen.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(true);
    expect(
      screen.getByText('画布加载失败，请先重试或新建一张画布。'),
    ).toBeTruthy();
  });
});

describe('AiChatPanel errors', () => {
  it('replaces the Codex CLI timeout with a Chinese retry prompt', async () => {
    const stream = controlledStream();
    stubFetch(stream.body);

    render(<AiChatPanel />);
    await sendMessage('Paint a cat');

    stream.push({
      error: { code: 'ai_chat_failed', message: 'Codex CLI timed out after 120000ms' },
    });
    stream.close();

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('请求超时（等待 120 秒）。')).toBeTruthy();
    expect(within(alert).getByRole('button', { name: '重试' })).toBeTruthy();
    expect(alert.textContent).not.toContain('Codex CLI');
  });

  it('translates backend error codes instead of showing their English message', async () => {
    const stream = controlledStream();
    stubFetch(stream.body);

    render(<AiChatPanel />);
    await sendMessage('Paint a cat');

    stream.push({ error: { code: 'canvas_required', message: 'Open a canvas first.' } });
    stream.close();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('请先新建一张画布，再让 AI 作画。');
    expect(alert.textContent).not.toContain('Open a canvas first.');
  });
});

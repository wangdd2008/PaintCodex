// @vitest-environment jsdom
import type { CanvasDocument } from '@paintcodex/protocol';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiChatPanel } from '../src/features/ai-chat/AiChatPanel';
import { useCanvasStore } from '../src/services/canvas-store';

function readyCanvas(revision = 1): CanvasDocument {
  return {
    id: 'canvas-1',
    name: '测试画布',
    width: 1920,
    height: 1080,
    backgroundColor: '#ffffff',
    revision,
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

/** 在假时钟冻结的前提下，让异步发送与流读取的后续步骤跑完。 */
async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) {
      await Promise.resolve();
    }
  });
}

async function sendMessage(text: string): Promise<void> {
  fireEvent.change(screen.getByPlaceholderText('描述你想画的内容…'), {
    target: { value: text },
  });

  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    for (let i = 0; i < 10; i += 1) {
      await Promise.resolve();
    }
  });
}

async function pushFrame(
  stream: ReturnType<typeof controlledStream>,
  payload: unknown,
): Promise<void> {
  await act(async () => {
    stream.push(payload);

    for (let i = 0; i < 10; i += 1) {
      await Promise.resolve();
    }
  });
}

async function closeStream(
  stream: ReturnType<typeof controlledStream>,
): Promise<void> {
  await act(async () => {
    stream.close();

    for (let i = 0; i < 10; i += 1) {
      await Promise.resolve();
    }
  });
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  // jsdom 没有实现元素滚动。
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
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  useCanvasStore.setState({
    canvas: null,
    status: 'idle',
    error: null,
    requestedCanvasId: null,
    saving: false,
    activeLayerId: null,
  });
});

describe('AiChatPanel 等待计时', () => {
  it('发送后每 1 秒更新已用 Ns', async () => {
    const stream = controlledStream();
    stubFetch(stream.body);
    render(<AiChatPanel />);

    await sendMessage('Paint a cat');

    expect(screen.getByText('已用 0s')).toBeTruthy();
    await advance(1000);
    expect(screen.getByText('已用 1s')).toBeTruthy();
    await advance(2000);
    expect(screen.getByText('已用 3s')).toBeTruthy();
  });

  it('完成后保留「已完成 · 用时 Ns」终态', async () => {
    const stream = controlledStream();
    stubFetch(stream.body);
    render(<AiChatPanel />);

    await sendMessage('Paint a cat');
    await advance(3000);

    await pushFrame(stream, { delta: 'A cat appears.' });
    await pushFrame(stream, { done: true });
    await closeStream(stream);

    expect(screen.getByText('已完成 · 用时 3s')).toBeTruthy();
    expect(screen.queryByText('已用 3s')).toBeNull();
    // 回复正文仍在；终态行不能取代它。
    expect(screen.getByText('A cat appears.')).toBeTruthy();
  });
});

describe('AiChatPanel 阶段顺序与落地确认', () => {
  it('按 delta → done 顺序推进，不再有四步进度文案', async () => {
    const stream = controlledStream();
    stubFetch(stream.body);
    render(<AiChatPanel />);

    await sendMessage('Paint a cat');

    // 还没有第一个 token：只显示等待文案与计时。
    expect(screen.getByText('思考中…')).toBeTruthy();
    expect(screen.queryByText(/正在构建请求|AI 正在思考|正在解析结果|正在应用到画布/)).toBeNull();

    await pushFrame(stream, { delta: 'A red circle.' });
    expect(screen.getByText('正在生成…')).toBeTruthy();
    expect(screen.queryByText('思考中…')).toBeNull();
    expect(screen.getByText('A red circle.')).toBeTruthy();
    expect(screen.queryByText(/已完成 · 用时/)).toBeNull();

    await pushFrame(stream, { done: true });
    await closeStream(stream);

    expect(screen.getByText('已完成 · 用时 0s')).toBeTruthy();
    expect(screen.queryByText('正在生成…')).toBeNull();
    expect(screen.getByText('A red circle.')).toBeTruthy();
  });

  it('消费 layerCreated，并在 revision 匹配时才提供撤销', async () => {
    const stream = controlledStream();
    stubFetch(stream.body);
    render(<AiChatPanel />);

    await sendMessage('画一个红色圆形');
    await pushFrame(stream, {
      layerCreated: { id: 'layer-1', name: 'AI — 红色圆形' },
    });
    await pushFrame(stream, { done: true });
    await closeStream(stream);

    expect(screen.getByText('已添加图层「AI — 红色圆形」')).toBeTruthy();
    // 快照尚未刷新到 AI 那一步，此时不能给出不安全的撤销按钮。
    expect(screen.queryByRole('button', { name: '撤销' })).toBeNull();

    act(() => {
      useCanvasStore.setState({ canvas: readyCanvas(2) });
    });
    expect(screen.getByRole('button', { name: '撤销' })).toBeTruthy();

    // 后续 mutation 已越过 AI 这一步：只留纯文本，没有撤销入口。
    act(() => {
      useCanvasStore.setState({ canvas: readyCanvas(3) });
    });
    expect(screen.queryByRole('button', { name: '撤销' })).toBeNull();
    expect(screen.getByText('已添加图层「AI — 红色圆形」')).toBeTruthy();
    expect(screen.getByText('已有后续操作，无法撤销')).toBeTruthy();
  });

  it('撤销以 AI 那一步的 revision 调用，并把确认行降级为已撤销', async () => {
    const stream = controlledStream();
    const undoneCanvas = readyCanvas(3);
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url) === '/paint/canvas/canvas-1/undo') {
        return {
          ok: true,
          status: 200,
          json: async () => undoneCanvas,
        } as unknown as Response;
      }
      return okResponse(stream.body);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AiChatPanel />);
    await sendMessage('画一个红色圆形');
    await pushFrame(stream, {
      layerCreated: { id: 'layer-1', name: 'AI — 红色圆形' },
    });
    await pushFrame(stream, { done: true });
    await closeStream(stream);

    act(() => {
      useCanvasStore.setState({ canvas: readyCanvas(2) });
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '撤销' }));
      for (let i = 0; i < 10; i += 1) {
        await Promise.resolve();
      }
    });
    await flush();

    expect(fetchMock).toHaveBeenCalledWith(
      '/paint/canvas/canvas-1/undo',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ expectedRevision: 2 }),
      }),
    );
    expect(screen.getByText('已撤销添加图层「AI — 红色圆形」')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '撤销' })).toBeNull();
  });
});

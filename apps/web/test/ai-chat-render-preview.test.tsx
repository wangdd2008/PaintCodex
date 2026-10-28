// @vitest-environment jsdom
import type { CanvasDocument } from '@paintcodex/protocol';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiChatPanel } from '../src/features/ai-chat/AiChatPanel';
import { useChatStore } from '../src/features/ai-chat/chat-store';
import { exportActiveCanvasPng } from '../src/services/canvas-engine';
import { useCanvasStore } from '../src/services/canvas-store';

vi.mock('../src/services/canvas-engine', () => ({
  exportActiveCanvasPng: vi.fn(),
}));

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

const PNG = 'data:image/png;base64,AAAA';
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
    close() {
      streamController?.close();
    },
  };
}

interface RenderPost {
  url: string;
  init: RequestInit | undefined;
}

/** Captures the render-result POST while streaming the chat from the test. */
function stubFetch(stream: ReadableStream<Uint8Array>): RenderPost[] {
  const posts: RenderPost[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/paint/ai/chat') {
        return { ok: true, status: 200, body: stream } as unknown as Response;
      }

      posts.push({ url, init });
      return { ok: true, status: 204 } as unknown as Response;
    }),
  );

  return posts;
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
  vi.mocked(exportActiveCanvasPng).mockReset();
  vi.mocked(exportActiveCanvasPng).mockReturnValue(PNG);
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

describe('AiChatPanel 画布预览', () => {
  it('renders the active canvas and posts it back for the request id', async () => {
    const stream = controlledStream();
    const posts = stubFetch(stream.body);
    render(<AiChatPanel />);

    await sendMessage('看一下现在画成什么样');
    stream.push({ renderRequest: { id: 'render-1', canvasId: 'canvas-1' } });

    await waitFor(() => expect(posts).toHaveLength(1));

    expect(posts[0]?.url).toBe('/paint/ai/render-result');
    expect(exportActiveCanvasPng).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(posts[0]?.init?.body))).toEqual({
      requestId: 'render-1',
      imageUrl: PNG,
    });

    // The chat keeps streaming after answering a render request.
    stream.push({ delta: '图画得不错' });
    expect(await screen.findByText('图画得不错')).toBeTruthy();
  });

  it('ignores a render request when there is no canvas to render', async () => {
    const stream = controlledStream();
    const posts = stubFetch(stream.body);
    vi.mocked(exportActiveCanvasPng).mockReturnValue(null);
    render(<AiChatPanel />);

    await sendMessage('看一下');
    stream.push({ renderRequest: { id: 'render-1', canvasId: 'canvas-1' } });

    await waitFor(() => expect(exportActiveCanvasPng).toHaveBeenCalled());
    expect(posts).toHaveLength(0);
  });

  it('shows a non-fatal notice without stopping the reply', async () => {
    const stream = controlledStream();
    stubFetch(stream.body);
    render(<AiChatPanel />);

    await sendMessage('继续');
    stream.push({ notice: '会话已重置，已开启新对话。' });
    stream.push({ delta: '我们从新会话继续。' });

    expect(await screen.findByText('会话已重置，已开启新对话。')).toBeTruthy();
    expect(await screen.findByText('我们从新会话继续。')).toBeTruthy();
  });
});

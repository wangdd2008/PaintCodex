// @vitest-environment jsdom
import type { CanvasDocument } from '@paintcodex/protocol';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiChatPanel } from '../src/features/ai-chat/AiChatPanel';
import { exportActiveCanvasPng } from '../src/services/canvas-engine';
import { useCanvasStore } from '../src/services/canvas-store';
import { downloadPng } from '../src/services/png-export';

vi.mock('../src/services/canvas-engine', () => ({
  exportActiveCanvasPng: vi.fn(),
}));

// Keep the real filename/blob helpers; only the download side effect is spied.
vi.mock('../src/services/png-export', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/png-export')>();

  return { ...actual, downloadPng: vi.fn() };
});

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
const EXPECTED_FILENAME = '测试画布-canvas-1.png';
// `AAAA` is four base64 chars for three bytes.
const EXPECTED_BYTES = 3;
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

interface Post {
  url: string;
  init: RequestInit | undefined;
}

/** Captures the non-chat POSTs while streaming the chat from the test. */
function stubFetch(stream: ReadableStream<Uint8Array>): Post[] {
  const posts: Post[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/paint/ai/chat') {
        return { ok: true, status: 200, body: stream } as unknown as Response;
      }

      posts.push({ url, init });

      if (url === '/paint/ai/confirm') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, status: 'approved', duplicate: false }),
        } as unknown as Response;
      }

      return { ok: true, status: 204 } as unknown as Response;
    }),
  );

  return posts;
}

function exportPosts(posts: Post[]): Post[] {
  return posts.filter((post) => post.url === '/paint/ai/export-result');
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
  vi.mocked(exportActiveCanvasPng).mockReset();
  vi.mocked(exportActiveCanvasPng).mockReturnValue(PNG);
  vi.mocked(downloadPng).mockReset();
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

describe('AiChatPanel 画布导出', () => {
  it('downloads the active canvas and reports the filename and size', async () => {
    const stream = controlledStream();
    const posts = stubFetch(stream.body);
    render(<AiChatPanel />);

    await sendMessage('把这张图导出来');
    stream.push({ exportRequest: { id: 'export-1', canvasId: 'canvas-1' } });

    await waitFor(() => expect(exportPosts(posts)).toHaveLength(1));

    expect(exportActiveCanvasPng).toHaveBeenCalledTimes(1);
    expect(downloadPng).toHaveBeenCalledWith(PNG, EXPECTED_FILENAME);
    expect(JSON.parse(String(exportPosts(posts)[0]?.init?.body))).toEqual({
      requestId: 'export-1',
      filename: EXPECTED_FILENAME,
      bytes: EXPECTED_BYTES,
    });

    // The chat keeps streaming after answering an export request.
    stream.push({ delta: '已经导出好了' });
    expect(await screen.findByText('已经导出好了')).toBeTruthy();
  });

  it('reports export_unavailable without downloading when the canvas is not ready', async () => {
    const stream = controlledStream();
    const posts = stubFetch(stream.body);
    vi.mocked(exportActiveCanvasPng).mockReturnValue(null);
    render(<AiChatPanel />);

    await sendMessage('导出一下');
    stream.push({ exportRequest: { id: 'export-1', canvasId: 'canvas-1' } });

    await waitFor(() => expect(exportPosts(posts)).toHaveLength(1));

    expect(downloadPng).not.toHaveBeenCalled();
    expect(JSON.parse(String(exportPosts(posts)[0]?.init?.body))).toEqual({
      requestId: 'export-1',
      error: expect.any(String),
    });
  });

  it('asks to download a PNG with an export-specific CTA', async () => {
    const stream = controlledStream();
    const posts = stubFetch(stream.body);
    render(<AiChatPanel />);

    await sendMessage('导出');
    stream.push({
      confirm: {
        id: 'confirm-export',
        title: '导出画布「测试画布」为 PNG',
        detail: '确认后会下载一张 PNG 图片到你的电脑。',
        approveLabel: '下载 PNG',
      },
    });

    const bar = await screen.findByRole('group', { name: '操作确认' });

    expect(within(bar).getByText('导出画布「测试画布」为 PNG')).toBeTruthy();
    expect(
      within(bar).getByText('确认后会下载一张 PNG 图片到你的电脑。'),
    ).toBeTruthy();

    // Not the delete CTA: approving this action downloads, it does not remove.
    fireEvent.click(within(bar).getByRole('button', { name: '下载 PNG' }));

    await waitFor(() => expect(posts.some((post) => post.url === '/paint/ai/confirm')).toBe(true));
    const confirmPost = posts.find((post) => post.url === '/paint/ai/confirm');

    expect(JSON.parse(String(confirmPost?.init?.body))).toMatchObject({
      requestId: 'confirm-export',
      approved: true,
    });
  });
});

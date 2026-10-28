// @vitest-environment jsdom
import type { CanvasDocument } from '@paintcodex/protocol';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
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

/** 由测试逐帧驱动的 SSE 流。 */
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
  vi.stubGlobal('fetch', vi.fn(async () => okResponse(body)));
}

function renderPanel(): void {
  render(<AiChatPanel />);
}

function typeDraft(text: string): void {
  fireEvent.change(screen.getByPlaceholderText('描述你想画的内容…'), {
    target: { value: text },
  });
}

async function sendMessage(text: string): Promise<void> {
  typeDraft(text);
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
}

async function pushFrames(
  stream: ReturnType<typeof controlledStream>,
  payloads: unknown[],
): Promise<void> {
  await act(async () => {
    for (const payload of payloads) {
      stream.push(payload);
    }
    stream.close();

    for (let i = 0; i < 10; i += 1) {
      await Promise.resolve();
    }
  });
}

function assistantBubbleText(): string {
  return (
    document.querySelector('.ai-chat__message--assistant .ai-chat__text')
      ?.textContent ?? ''
  );
}

function sentMessages(
  fetchMock: ReturnType<typeof vi.fn>,
): string[] {
  return fetchMock.mock.calls.map((call) => {
    const init = call[1] as RequestInit | undefined;
    return (JSON.parse(String(init?.body)) as { message: string }).message;
  });
}

beforeEach(() => {
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

describe('AiChatPanel 错误分类', () => {
  it('daemon 不可达时显示中文原因与重试按钮，不显示英文原串', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );

    renderPanel();
    await sendMessage('画一只猫');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('无法连接到本地服务');
    expect(alert.textContent).not.toContain('Failed to fetch');
    expect(within(alert).getByRole('button', { name: '重试' })).toBeTruthy();
  });

  it('5xx 映射为中文服务不可用，不出现 AI request failed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }) as unknown as Response),
    );

    renderPanel();
    await sendMessage('画一只猫');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('AI 服务暂时不可用（服务器错误）。');
    expect(alert.textContent).not.toContain('AI request failed');
    expect(within(alert).getByRole('button', { name: '重试' })).toBeTruthy();
  });

  it('canvas_required 映射为中文提示，不显示后端英文 message', async () => {
    const stream = controlledStream();
    stubFetch(stream.body);
    renderPanel();
    await sendMessage('画一只猫');

    await pushFrames(stream, [
      { error: { code: 'canvas_required', message: 'Open a canvas first.' } },
    ]);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('请先新建一张画布，再让 AI 作画。');
    expect(alert.textContent).not.toContain('Open a canvas first.');
  });

  it('超时文案的「重试」是可点按钮，而不是纯文字', async () => {
    const stream = controlledStream();
    stubFetch(stream.body);
    renderPanel();
    await sendMessage('画一只猫');

    await pushFrames(stream, [
      { error: { code: 'ai_chat_failed', message: 'Codex CLI timed out after 120000ms' } },
    ]);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('请求超时（等待 120 秒）。');
    const retry = within(alert).getByRole('button', { name: '重试' });
    expect(retry).toBeTruthy();
    expect(alert.textContent).not.toContain('timed out');
  });
});

describe('AiChatPanel 失败气泡与草稿', () => {
  it('失败气泡标「未完成」，不留无内容的空气泡', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );

    renderPanel();
    await sendMessage('画一只猫');
    await screen.findByRole('alert');

    expect(assistantBubbleText()).toContain('未完成');
    expect(assistantBubbleText().trim().length).toBeGreaterThan(0);
    expect(screen.queryByText('我已按你的描述生成图层。')).toBeNull();
  });

  it('失败后输入框为空才恢复草稿', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );

    renderPanel();
    const input = screen.getByPlaceholderText('描述你想画的内容…') as HTMLTextAreaElement;

    await sendMessage('画一只猫');
    await screen.findByRole('alert');

    expect(input.value).toBe('画一只猫');
  });

  it('用户已重新输入时不覆盖新草稿', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPanel();
    const input = screen.getByPlaceholderText('描述你想画的内容…') as HTMLTextAreaElement;

    await sendMessage('画一只猫');
    await screen.findByRole('alert');
    expect(input.value).toBe('画一只猫');

    typeDraft('新的草稿');
    fireEvent.click(screen.getByRole('button', { name: '重试' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await screen.findByRole('alert');

    expect(input.value).toBe('新的草稿');
    // 重试重发的是失败那一轮，不是新草稿。
    expect(sentMessages(fetchMock)).toEqual(['画一只猫', '画一只猫']);
  });
});

describe('AiChatPanel 重试', () => {
  it('复用最后一条用户消息与助手气泡，只再发一次请求', async () => {
    const stream = controlledStream();
    let attempts = 0;
    const fetchMock = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new TypeError('Failed to fetch');
      }
      return okResponse(stream.body);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPanel();
    await sendMessage('画一只猫');

    const alert = await screen.findByRole('alert');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(within(alert).getByRole('button', { name: '重试' }));
    await screen.findByText('思考中…');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await pushFrames(stream, [{ delta: '画好了。' }, { done: true }]);

    expect(await screen.findByText('画好了。')).toBeTruthy();
    expect(screen.getAllByText('画一只猫')).toHaveLength(1);
    expect(screen.queryByText('未完成')).toBeNull();
    expect(sentMessages(fetchMock)).toEqual(['画一只猫', '画一只猫']);
  });
});

describe('AiChatPanel 取消', () => {
  it('取消保持「已取消」，不进错误分支，也不显示重试', async () => {
    const stream = controlledStream();

    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        init?.signal?.addEventListener(
          'abort',
          () => {
            stream.fail(new DOMException('The operation was aborted.', 'AbortError'));
          },
          { once: true },
        );
        return okResponse(stream.body);
      }),
    );

    renderPanel();
    await sendMessage('画一只猫');

    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    expect(await screen.findByText('已取消')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull();
    expect(assistantBubbleText()).toContain('已取消');
    expect(assistantBubbleText()).not.toContain('未完成');
  });
});

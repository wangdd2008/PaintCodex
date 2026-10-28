// @vitest-environment jsdom
import type { CanvasDocument } from '@paintcodex/protocol';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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

const CONFIRM_FRAME = {
  confirm: {
    id: 'confirm-1',
    title: '删除图层「红圆」',
    detail: '这是不可逆操作：确认后该图层会从画布上移除。',
  },
};

function stubFetch(streamBody: ReadableStream<Uint8Array>) {
  const fetchMock = vi.fn(
    async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      if (String(url) === '/paint/ai/confirm') {
        const body = JSON.parse(String(init?.body ?? '{}')) as { approved?: boolean };

        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            status: body.approved === true ? 'approved' : 'declined',
            duplicate: false,
          }),
        } as unknown as Response;
      }

      return { ok: true, status: 200, body: streamBody } as unknown as Response;
    },
  );

  vi.stubGlobal('fetch', fetchMock);

  return fetchMock;
}

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

async function advance(ms: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

function confirmCalls(fetchMock: ReturnType<typeof stubFetch>) {
  return fetchMock.mock.calls.filter(([url]) => String(url) === '/paint/ai/confirm');
}

beforeEach(() => {
  vi.useFakeTimers();
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

describe('AiChatPanel 删除确认', () => {
  it('在助手气泡内渲染确认条与「删除 / 取消」两个按钮', async () => {
    const stream = controlledStream();
    stubFetch(stream.body);
    render(<AiChatPanel />);

    await sendMessage('删掉红圆');
    await pushFrame(stream, CONFIRM_FRAME);

    const bar = screen.getByRole('group', { name: '操作确认' });

    expect(within(bar).getByText('删除图层「红圆」')).toBeTruthy();
    expect(
      within(bar).getByText('这是不可逆操作：确认后该图层会从画布上移除。'),
    ).toBeTruthy();
    expect(within(bar).getByRole('button', { name: '删除' }).hasAttribute('disabled')).toBe(
      false,
    );
    expect(within(bar).getByRole('button', { name: '取消' }).hasAttribute('disabled')).toBe(
      false,
    );

    stream.close();
  });

  it('点「删除」后提交一次批准并把确认条标为已确认', async () => {
    const stream = controlledStream();
    const fetchMock = stubFetch(stream.body);
    render(<AiChatPanel />);

    await sendMessage('删掉红圆');
    await pushFrame(stream, CONFIRM_FRAME);

    const bar = screen.getByRole('group', { name: '操作确认' });

    await act(async () => {
      fireEvent.click(within(bar).getByRole('button', { name: '删除' }));
    });
    await flush();

    expect(confirmCalls(fetchMock)).toHaveLength(1);
    expect(JSON.parse(String(confirmCalls(fetchMock)[0]?.[1]?.body))).toEqual({
      requestId: 'confirm-1',
      approved: true,
      canvasId: 'canvas-1',
    });
    expect(within(bar).getByText('已确认')).toBeTruthy();
    expect(within(bar).getByRole('button', { name: '删除' }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(within(bar).getByRole('button', { name: '取消' }).hasAttribute('disabled')).toBe(
      true,
    );

    stream.close();
  });

  it('点「取消」提交拒绝并标记为已取消', async () => {
    const stream = controlledStream();
    const fetchMock = stubFetch(stream.body);
    render(<AiChatPanel />);

    await sendMessage('删掉红圆');
    await pushFrame(stream, CONFIRM_FRAME);

    const bar = screen.getByRole('group', { name: '操作确认' });

    await act(async () => {
      fireEvent.click(within(bar).getByRole('button', { name: '取消' }));
    });
    await flush();

    expect(confirmCalls(fetchMock)).toHaveLength(1);
    expect(JSON.parse(String(confirmCalls(fetchMock)[0]?.[1]?.body))).toMatchObject({
      requestId: 'confirm-1',
      approved: false,
    });
    expect(within(bar).getByText('已取消')).toBeTruthy();

    stream.close();
  });

  it('60 秒未答复后显示已超时并禁用按钮，不再提交', async () => {
    const stream = controlledStream();
    const fetchMock = stubFetch(stream.body);
    render(<AiChatPanel />);

    await sendMessage('删掉红圆');
    await pushFrame(stream, CONFIRM_FRAME);
    await advance(60_000);

    const bar = screen.getByRole('group', { name: '操作确认' });

    expect(within(bar).getByText('确认已超时')).toBeTruthy();
    expect(within(bar).getByRole('button', { name: '删除' }).hasAttribute('disabled')).toBe(
      true,
    );

    fireEvent.click(within(bar).getByRole('button', { name: '删除' }));
    await flush();
    expect(confirmCalls(fetchMock)).toHaveLength(0);

    stream.close();
  });

  it('连续点击只提交一次', async () => {
    const stream = controlledStream();
    const fetchMock = stubFetch(stream.body);
    render(<AiChatPanel />);

    await sendMessage('删掉红圆');
    await pushFrame(stream, CONFIRM_FRAME);

    const bar = screen.getByRole('group', { name: '操作确认' });
    const approve = within(bar).getByRole('button', { name: '删除' });

    await act(async () => {
      fireEvent.click(approve);
      fireEvent.click(approve);
    });
    await flush();

    expect(confirmCalls(fetchMock)).toHaveLength(1);

    stream.close();
  });
});

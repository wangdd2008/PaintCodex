// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiChatPanel } from '../src/features/ai-chat/AiChatPanel';

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
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
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

describe('AiChatPanel step progress', () => {
  it('shows the current backend step inside the assistant bubble until the reply lands', async () => {
    const stream = controlledStream();
    stubFetch(stream.body);

    render(<AiChatPanel />);
    await sendMessage('Paint a cat');

    stream.push({ step: { id: 'prompt_built', label: '正在构建请求…' } });
    stream.push({ step: { id: 'codex_exec', label: 'AI 正在思考…' } });
    expect(await screen.findByText('AI 正在思考…')).toBeTruthy();

    stream.push({ delta: 'A cat appears.' });
    stream.push({ done: true });
    stream.close();

    expect(await screen.findByText('A cat appears.')).toBeTruthy();
    expect(screen.queryByText('AI 正在思考…')).toBeNull();
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

describe('AiChatPanel errors', () => {
  it('replaces the Codex CLI timeout with a retry prompt', async () => {
    const stream = controlledStream();
    stubFetch(stream.body);

    render(<AiChatPanel />);
    await sendMessage('Paint a cat');

    stream.push({
      error: { code: 'ai_chat_failed', message: 'Codex CLI timed out after 120000ms' },
    });
    stream.close();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('请求超时，请重试');
  });

  it('keeps other backend error messages verbatim', async () => {
    const stream = controlledStream();
    stubFetch(stream.body);

    render(<AiChatPanel />);
    await sendMessage('Paint a cat');

    stream.push({ error: { code: 'canvas_required', message: 'Open a canvas first.' } });
    stream.close();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Open a canvas first.');
  });
});

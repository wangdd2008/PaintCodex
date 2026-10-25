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
  fireEvent.change(screen.getByPlaceholderText('Describe what to paint…'), {
    target: { value: text },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  // Yield so the request starts and the first frames are consumed.
  await screen.findByText(text);
}

beforeEach(() => {
  // jsdom does not implement element scrolling.
  Object.defineProperty(window.HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    value: () => undefined,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
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
  it('replaces Send with 取消, aborts the request and marks the bubble 已取消', async () => {
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

    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    expect(await screen.findByText('已取消')).toBeTruthy();
    expect(aborted).toBe(true);
    // Cancelling is a user action, not a failure.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy();
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

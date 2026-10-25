// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiChatPanel } from '../src/features/ai-chat/AiChatPanel';

/** Minimal streaming response for the chat fetch boundary; no server code runs. */
function streamingResponse(payload: string): Response {
  const encoder = new TextEncoder();
  let consumed = false;
  const body = {
    getReader: () => ({
      read: async () => {
        if (consumed) {
          return { done: true, value: undefined };
        }
        consumed = true;
        return { done: false, value: encoder.encode(payload) };
      },
    }),
  };
  return { ok: true, body } as unknown as Response;
}

describe('AiChatPanel clear input', () => {
  beforeEach(() => {
    Element.prototype.scrollTo = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

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

  it('leaves the sent conversation untouched', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(streamingResponse('data: {"done":true}\n\n')),
    );
    render(<AiChatPanel />);
    const input = screen.getByRole('textbox') as HTMLTextAreaElement;

    fireEvent.change(input, { target: { value: 'first message' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('first message')).toBeTruthy();

    fireEvent.change(input, { target: { value: 'draft to clear' } });
    fireEvent.click(screen.getByRole('button', { name: '清空' }));
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));

    expect(screen.getByText('first message')).toBeTruthy();
  });
});

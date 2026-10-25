import { CANVAS_ACTION_MARKER } from '@paintcodex/protocol';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useCanvasStore } from '../../services/canvas-store';
import './ai-chat.css';

interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
}

interface StreamPayload {
  delta?: unknown;
  done?: unknown;
  error?: { code?: unknown; message?: unknown };
}

const FALLBACK_ERROR =
  'The AI assistant could not respond. Check that the Codex CLI is installed and signed in.';

/** Hides the machine-readable canvas action from the chat bubble. */
function visibleAssistantText(content: string): string {
  const markerIndex = content.indexOf(CANVAS_ACTION_MARKER);

  return markerIndex >= 0 ? content.slice(0, markerIndex).trim() : content;
}

function parseFrame(frame: string): StreamPayload | null {
  const data = frame
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');

  if (data.length === 0) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(data);
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }
    return parsed as StreamPayload;
  } catch {
    return null;
  }
}

export function AiChatPanel() {
  const [open, setOpen] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [inFlight, setInFlight] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nextId = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) {
      node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' });
    }
  }, [messages, inFlight, error]);

  const appendToAssistant = (delta: string) => {
    setMessages((previous) => {
      const last = previous[previous.length - 1];
      if (!last || last.role !== 'assistant') {
        return previous;
      }
      return [...previous.slice(0, -1), { ...last, content: last.content + delta }];
    });
  };

  const handleFrame = (frame: string) => {
    const payload = parseFrame(frame);
    if (!payload) {
      return;
    }

    if (typeof payload.delta === 'string') {
      appendToAssistant(payload.delta);
      return;
    }

    if (payload.done === true) {
      return;
    }

    if (payload.error) {
      const detail =
        typeof payload.error.message === 'string' && payload.error.message.length > 0
          ? payload.error.message
          : FALLBACK_ERROR;
      throw new Error(detail);
    }
  };

  const send = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();

    const message = input.trim();
    if (message.length === 0 || inFlight) {
      return;
    }

    setInput('');
    setError(null);
    setInFlight(true);

    const userMessage: ChatMessage = {
      id: nextId.current++,
      role: 'user',
      content: message,
    };
    const assistantMessage: ChatMessage = {
      id: nextId.current++,
      role: 'assistant',
      content: '',
    };
    setMessages((previous) => [...previous, userMessage, assistantMessage]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const canvasId = useCanvasStore.getState().canvas?.id;
      const response = await fetch('/paint/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, canvasId }),
        signal: controller.signal,
      });

      if (!response.ok) {
        let detail = `AI request failed (${response.status})`;
        try {
          const body = (await response.json()) as { error?: { message?: unknown } };
          if (typeof body.error?.message === 'string') {
            detail = body.error.message;
          }
        } catch {
          // Keep the status-based message when the body is not JSON.
        }
        throw new Error(detail);
      }

      if (!response.body) {
        throw new Error('The daemon returned an empty response stream.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        let boundary = buffer.indexOf('\n\n');
        while (boundary >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          handleFrame(frame);
          boundary = buffer.indexOf('\n\n');
        }
      }
    } catch (cause) {
      if (controller.signal.aborted) {
        return;
      }
      setError(cause instanceof Error ? cause.message : FALLBACK_ERROR);
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      setInFlight(false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };

  return (
    <section className="ai-chat" aria-label="AI chat">
      <button
        type="button"
        className="ai-chat__toggle"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        AI Chat {open ? '▾' : '▸'}
      </button>

      {open ? (
        <div className="ai-chat__body">
          <div
            className="ai-chat__messages"
            ref={scrollRef}
            aria-live="polite"
            aria-busy={inFlight}
          >
            {messages.length === 0 ? (
              <p className="ai-chat__empty">
                Ask the painting assistant about composition, color, or what to paint next.
              </p>
            ) : (
              messages.map((message) => (
                <article
                  key={message.id}
                  className={`ai-chat__message ai-chat__message--${message.role}`}
                >
                  <span className="ai-chat__role">
                    {message.role === 'user' ? 'You' : 'AI'}
                  </span>
                  <p className="ai-chat__text">
                    {visibleAssistantText(message.content).length > 0
                      ? visibleAssistantText(message.content)
                      : inFlight && message.role === 'assistant'
                        ? 'Thinking…'
                        : ''}
                  </p>
                </article>
              ))
            )}
          </div>

          {error ? (
            <p className="ai-chat__error" role="alert">
              {error}
            </p>
          ) : null}

          <form className="ai-chat__composer" onSubmit={(event) => void send(event)}>
            <textarea
              className="ai-chat__input"
              placeholder="Describe what to paint…"
              rows={3}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              disabled={inFlight}
            />
            <button
              type="submit"
              className="ai-chat__send"
              disabled={inFlight || input.trim().length === 0}
            >
              {inFlight ? 'Thinking…' : 'Send'}
            </button>
          </form>
        </div>
      ) : null}
    </section>
  );
}

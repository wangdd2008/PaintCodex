import { CANVAS_ACTION_MARKER, type StreamPayload } from '@paintcodex/protocol';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useCanvasStore } from '../../services/canvas-store';
import './ai-chat.css';

interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  /** Set on the pending reply when the user cancels it. */
  cancelled?: boolean;
}

/** The protocol owns the step shape so frontend and daemon cannot drift. */
type ChatStep = NonNullable<StreamPayload['step']>;

const FALLBACK_ERROR =
  'AI 助手无法响应。请检查 Codex CLI 是否已安装并已登录。';

/** The runner's timeout text is machine-facing; users get an actionable line. */
function userFacingError(message: string): string {
  return /Codex CLI timed out after \d+ms/.test(message)
    ? '请求超时，请重试'
    : message;
}

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
  const [lastInput, setLastInput] = useState<string | null>(null);
  const [inFlight, setInFlight] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState<ChatStep | null>(null);

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

  const updateLastAssistant = (update: (message: ChatMessage) => ChatMessage) => {
    setMessages((previous) => {
      const last = previous[previous.length - 1];
      if (!last || last.role !== 'assistant') {
        return previous;
      }
      return [...previous.slice(0, -1), update(last)];
    });
  };

  const appendToAssistant = (delta: string) => {
    updateLastAssistant((last) => ({ ...last, content: last.content + delta }));
  };

  const markAssistantCancelled = () => {
    updateLastAssistant((last) => ({ ...last, cancelled: true }));
  };

  const cancel = () => {
    abortRef.current?.abort();
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

    if (payload.step) {
      const { id, label } = payload.step;
      if (typeof id === 'string' && typeof label === 'string') {
        setCurrentStep({ id, label });
        return;
      }
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
    setLastInput(null);
    setError(null);
    setCurrentStep(null);
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
        markAssistantCancelled();
        return;
      }
      setError(
        userFacingError(cause instanceof Error ? cause.message : FALLBACK_ERROR),
      );
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      setCurrentStep(null);
      setInFlight(false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };

  const clearInput = () => {
    setLastInput(input);
    setInput('');
  };

  /** Editing a new draft retires the undo offer: it only ever restores this clear. */
  const handleInputChange = (value: string) => {
    setInput(value);
    if (value.length > 0) {
      setLastInput(null);
    }
  };

  const undoClear = () => {
    if (lastInput === null) {
      return;
    }
    setInput(lastInput);
    setLastInput(null);
  };

  return (
    <section className="ai-chat" aria-label="AI chat">
      <button
        type="button"
        className="ai-chat__toggle"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        AI 对话 {open ? '▾' : '▸'}
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
                向绘画助手咨询构图、配色，或者下一步该画什么。
              </p>
            ) : (
              messages.map((message) => {
                const text = visibleAssistantText(message.content);
                const step = inFlight && message.role === 'assistant' ? currentStep : null;

                return (
                  <article
                    key={message.id}
                    className={`ai-chat__message ai-chat__message--${message.role}`}
                  >
                    <span className="ai-chat__role">
                      {message.role === 'user' ? '你' : 'AI 助手'}
                    </span>
                    <p className="ai-chat__text">
                      {step ? (
                        // Keyed by step id so every backend step replays the fade-in.
                        <span className="ai-chat__step" key={step.id}>
                          {step.label}
                        </span>
                      ) : null}
                      {text.length > 0
                        ? text
                        : inFlight && message.role === 'assistant' && !step
                          ? '思考中…'
                          : ''}
                      {message.cancelled ? (
                        <span className="ai-chat__cancelled">已取消</span>
                      ) : null}
                    </p>
                  </article>
                );
              })
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
              placeholder="描述你想画的内容…"
              rows={3}
              value={input}
              onChange={(event) => handleInputChange(event.target.value)}
              onKeyDown={handleKeyDown}
              disabled={inFlight}
            />
            <div className="ai-chat__actions">
              {/* Draft actions stay hidden while a request runs, so the cancel
                  button never toggles the clear/undo state. */}
              {!inFlight && lastInput !== null ? (
                <button type="button" className="ai-chat__clear" onClick={undoClear}>
                  撤销
                </button>
              ) : !inFlight && input.length > 0 ? (
                <button type="button" className="ai-chat__clear" onClick={clearInput}>
                  清空
                </button>
              ) : null}
              {inFlight ? (
                <button type="button" className="ai-chat__cancel" onClick={cancel}>
                  取消
                </button>
              ) : (
                <button
                  type="submit"
                  className="ai-chat__send"
                  disabled={input.trim().length === 0}
                >
                  发送
                </button>
              )}
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}

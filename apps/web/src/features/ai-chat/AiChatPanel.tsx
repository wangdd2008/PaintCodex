import { CANVAS_ACTION_MARKER, type StreamPayload } from '@paintcodex/protocol';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useCanvasStore, type CanvasStatus } from '../../services/canvas-store';
import './ai-chat.css';

/** 这次回复落地的 AI 图层，以及撤销守卫要比较的 revision。 */
interface ChatLayerConfirmation {
  id: string;
  name: string;
  canvasId: string | null;
  /** AI 图层生成后产生的 revision；只有当前 revision 与它相等时才允许撤销。 */
  expectedRevision: number;
  /** 用户已撤销这一步，避免撤销入口再次出现。 */
  undone?: boolean;
}

interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  /** Set on the pending reply when the user cancels it. */
  cancelled?: boolean;
  /** 首个 delta 已到达：等待文案切换为「正在生成…」。 */
  generating?: boolean;
  /** done 时结算的固定用时；运行结束后继续保留。 */
  durationSeconds?: number;
  /** 从 `layerCreated` 帧消费到的落地确认。 */
  layer?: ChatLayerConfirmation;
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

/**
 * AI actions always need a canvas to land on. Explaining why the composer is
 * disabled keeps the assistant from promising layers with nowhere to put them.
 */
function composerBlockedReason(
  hasCanvas: boolean,
  status: CanvasStatus,
): string | null {
  if (hasCanvas) {
    return null;
  }

  if (status === 'loading') {
    return '画布正在加载，请稍候。';
  }

  if (status === 'error') {
    return '画布加载失败，请先重试或新建一张画布。';
  }

  return '先新建一张画布，再让 AI 作画。';
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
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const canvas = useCanvasStore((state) => state.canvas);
  const status = useCanvasStore((state) => state.status);
  const currentCanvasId = useCanvasStore((state) => state.canvas?.id ?? null);
  const currentRevision = useCanvasStore((state) => state.canvas?.revision ?? null);
  const blockedReason = composerBlockedReason(canvas !== null, status);

  const nextId = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  /** 本次回复的墙钟起点，供每秒计时与终态用时共用。 */
  const runStartedAt = useRef<number | null>(null);
  /** 请求发出时的 revision，用来推算 AI 那一步的 revision。 */
  const runStartRevision = useRef<number | null>(null);
  /** 请求针对的画布；确认行绝不能撤销另一张画布。 */
  const runCanvasId = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // 每秒刷新一次计时；生成期间也继续计时。
  useEffect(() => {
    if (!inFlight) {
      return;
    }

    const startedAt = runStartedAt.current;
    if (startedAt === null) {
      return;
    }

    const timer = setInterval(() => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    }, 1000);

    return () => clearInterval(timer);
  }, [inFlight]);

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
    updateLastAssistant((last) => ({
      ...last,
      content: last.content + delta,
      generating: true,
    }));
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

    if (payload.layerCreated) {
      const { id, name } = payload.layerCreated;

      if (typeof id === 'string' && typeof name === 'string') {
        // AI 图层只比发出时的 revision 多一步；运行期间又画了一笔、
        // 另一个标签页写入或发生重试时，守卫保持关闭，
        // 宁可不给撤销，也不撤掉不属于这一步的快照。
        const startRevision = runStartRevision.current ?? 0;

        updateLastAssistant((last) => ({
          ...last,
          layer: {
            id,
            name,
            canvasId: runCanvasId.current,
            expectedRevision: startRevision + 1,
          },
        }));
        return;
      }
    }

    if (payload.done === true) {
      const startedAt = runStartedAt.current;
      const durationSeconds =
        startedAt === null
          ? 0
          : Math.max(0, Math.floor((Date.now() - startedAt) / 1000));

      setElapsedSeconds(durationSeconds);
      updateLastAssistant((last) => ({ ...last, durationSeconds }));
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

    if (!useCanvasStore.getState().canvas) {
      return;
    }

    setInput('');
    setLastInput(null);
    setError(null);
    setCurrentStep(null);
    setElapsedSeconds(0);
    runStartedAt.current = Date.now();
    runStartRevision.current = useCanvasStore.getState().canvas?.revision ?? null;
    runCanvasId.current = useCanvasStore.getState().canvas?.id ?? null;
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
        let detail = `AI 请求失败（状态码 ${response.status}）`;
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
        throw new Error('AI 请求失败：本地服务没有返回内容流。');
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
      runStartedAt.current = null;
      runStartRevision.current = null;
      runCanvasId.current = null;
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

  /** 快照级撤销只在 AI 这一步仍是最新 revision 时安全。 */
  const canUndoLayer = (layer: ChatLayerConfirmation): boolean =>
    layer.undone !== true &&
    layer.canvasId !== null &&
    layer.canvasId === currentCanvasId &&
    currentRevision !== null &&
    currentRevision === layer.expectedRevision;

  /** 后续 mutation 已越过 AI 这一步：只给纯文本，不给撤销入口。 */
  const isLayerStale = (layer: ChatLayerConfirmation): boolean =>
    layer.undone !== true &&
    layer.canvasId !== null &&
    layer.canvasId === currentCanvasId &&
    currentRevision !== null &&
    currentRevision > layer.expectedRevision;

  /** 只撤销 AI 这一步；revision 守卫已证明不会丢掉后续操作。 */
  const undoLayer = async (messageId: number) => {
    const message = messages.find((item) => item.id === messageId);
    const layer = message?.layer;

    if (!layer || !canUndoLayer(layer)) {
      return;
    }

    await useCanvasStore.getState().undo();

    const after = useCanvasStore.getState().canvas;
    const layerStillThere =
      after?.layers.some((item) => item.id === layer.id) ?? true;

    if (!layerStillThere) {
      setMessages((previous) =>
        previous.map((item) =>
          item.id === messageId && item.layer
            ? { ...item, layer: { ...item.layer, undone: true } }
            : item,
        ),
      );
    }
  };

  const lastMessageId = messages[messages.length - 1]?.id ?? null;

  return (
    <section className="ai-chat" aria-label="AI 对话">
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
                const isPending =
                  inFlight &&
                  message.role === 'assistant' &&
                  message.id === lastMessageId;
                const step = isPending ? currentStep : null;
                // 最后两步描述结果落地，首个 token 之后仍继续显示，
                // 不能一直停在「正在生成…」。
                const applyStep =
                  step?.id === 'action_parse' || step?.id === 'action_apply'
                    ? step
                    : null;
                const progressLabel =
                  applyStep?.label ??
                  (message.generating ? '正在生成…' : step?.label ?? '思考中…');
                const progressKey =
                  applyStep?.id ??
                  (message.generating ? 'generating' : step?.id ?? 'waiting');

                return (
                  <article
                    key={message.id}
                    className={`ai-chat__message ai-chat__message--${message.role}`}
                  >
                    <span className="ai-chat__role">
                      {message.role === 'user' ? '你' : 'AI 助手'}
                    </span>
                    <p className="ai-chat__text">
                      {isPending ? (
                        <span className="ai-chat__progress">
                          {/* Keyed by phase so every step replays the fade-in. */}
                          <span className="ai-chat__step" key={progressKey}>
                            {progressLabel}
                          </span>
                          <span className="ai-chat__timer">
                            已用 {elapsedSeconds}s
                          </span>
                        </span>
                      ) : null}
                      {text}
                      {message.cancelled ? (
                        <span className="ai-chat__cancelled">已取消</span>
                      ) : null}
                    </p>
                    {/* 终态在运行结束后保留，不能清空为空白。 */}
                    {!isPending && message.durationSeconds !== undefined ? (
                      <span className="ai-chat__terminal">
                        已完成 · 用时 {message.durationSeconds}s
                      </span>
                    ) : null}
                    {message.layer ? (
                      <div className="ai-chat__landing">
                        <span className="ai-chat__landing-text">
                          {message.layer.undone
                            ? `已撤销添加图层「${message.layer.name}」`
                            : `已添加图层「${message.layer.name}」`}
                        </span>
                        {canUndoLayer(message.layer) ? (
                          <>
                            <span aria-hidden="true"> · </span>
                            <button
                              type="button"
                              className="ai-chat__landing-undo"
                              onClick={() => void undoLayer(message.id)}
                            >
                              撤销
                            </button>
                          </>
                        ) : isLayerStale(message.layer) ? (
                          <>
                            <span aria-hidden="true"> · </span>
                            <span className="ai-chat__landing-note">
                              已有后续操作，无法撤销
                            </span>
                          </>
                        ) : null}
                      </div>
                    ) : null}
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

          {blockedReason ? (
            <p className="ai-chat__blocked" role="status">
              {blockedReason}
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
              disabled={inFlight || blockedReason !== null}
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
                  disabled={input.trim().length === 0 || blockedReason !== null}
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

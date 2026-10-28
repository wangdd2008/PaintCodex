import type { CanvasRegion, StreamPayload } from '@paintcodex/protocol';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { postExportResult, postRenderResult } from '../../services/api';
import { exportActiveCanvasPng } from '../../services/canvas-engine';
import { useCanvasStore, type CanvasStatus } from '../../services/canvas-store';
import { displayCanvasName } from '../../services/naming';
import { canvasPngFilename, dataUrlToBlob, downloadPng } from '../../services/png-export';
import { useChatStore } from './chat-store';
import type {
  ChatConfirmation,
  ChatLayerConfirmation,
  ChatMessage,
  ChatToolLine,
} from './chat-message';
import { describeChatFailure, type ChatFailure } from './chat-error';
import './ai-chat.css';

/** 撤销入口的三种状态：可撤销、已有后续操作、不适用。 */
type LayerUndoState = 'available' | 'stale' | 'hidden';

/** 撤销守卫的唯一判定：撤销、陈旧提示与隐藏都从这里派生。 */
function layerUndoState(
  layer: ChatLayerConfirmation,
  canvasId: string | null,
  revision: number | null,
): LayerUndoState {
  if (
    layer.undone === true ||
    layer.canvasId === null ||
    layer.canvasId !== canvasId ||
    revision === null
  ) {
    return 'hidden';
  }

  if (revision === layer.expectedRevision) {
    return 'available';
  }

  if (revision > layer.expectedRevision) {
    return 'stale';
  }

  return 'hidden';
}

/** 60 秒内不答复即视为拒绝，和 daemon 的硬超时一致。 */
const CONFIRM_TIMEOUT_MS = 60_000;

const CONFIRM_STATUS_TEXT: Partial<Record<ChatConfirmation['status'], string>> = {
  submitting: '正在提交…',
  approved: '已确认',
  declined: '已取消',
  expired: '确认已超时',
};

/**
 * 读操作折叠：AI 每轮都会先读画布，行行都显示只会淹没真正的写动作。
 * 只有声明了文案的写工具才成行，未知工具同样不渲染。
 */
const READ_ONLY_TOOLS = new Set(['canvas_get_context', 'canvas_select']);

const WRITE_TOOL_LABELS: Record<
  string,
  { running: string; ok: string; failed: string }
> = {
  canvas_create_layer: {
    running: '正在添加图层…',
    ok: '已添加图层',
    failed: '添加图层失败',
  },
  canvas_update_layer: {
    running: '正在改写图层…',
    ok: '已改写图层',
    failed: '改写图层失败',
  },
  canvas_delete_layer: {
    running: '正在删除图层…',
    ok: '已删除图层',
    failed: '删除图层失败',
  },
  canvas_undo: {
    running: '正在撤销…',
    ok: '已撤销上一步',
    failed: '撤销失败',
  },
  canvas_export_png: {
    running: '正在导出图片…',
    ok: '已导出图片',
    failed: '导出图片失败',
  },
};

/** 失败码的中文说明；未登记的码只显示通用失败文案，不把原始码上屏。 */
const TOOL_FAILURE_TEXT: Record<string, string> = {
  revision_conflict: '画布已被改动，未覆盖最新内容',
  layer_not_found: '图层不存在',
  canvas_not_found: '画布不存在',
  canvas_required: '请先打开画布',
  top_action_is_user: '栈顶是你自己的操作，需要你自己撤销',
  invalid_svg: 'SVG 不安全，已拒绝',
  invalid_arguments: '工具参数不合法',
  user_declined: '你取消了这次操作',
  nothing_to_undo: '没有可撤销的操作',
  export_unavailable: '浏览器无法导出，请确认画布已打开',
  export_busy: '这张画布已有导出在进行',
  no_active_turn: '这一轮已经结束',
  tool_timeout: '操作超时',
  tool_failed: '工具执行失败',
  unknown_tool: '未声明的工具',
};

function toolLineText(tool: ChatToolLine): string {
  const labels = WRITE_TOOL_LABELS[tool.name];

  if (!labels) {
    return '';
  }

  const base = labels[tool.status];

  if (tool.status !== 'failed') {
    return base;
  }

  const reason = tool.code === undefined ? undefined : TOOL_FAILURE_TEXT[tool.code];

  return reason === undefined ? base : `${base}：${reason}`;
}

/** 写工具才成行；读取与未知工具不进渲染列表。 */
function writeToolLines(message: ChatMessage): ChatToolLine[] {
  return (message.tools ?? []).filter(
    (tool) => !READ_ONLY_TOOLS.has(tool.name) && tool.name in WRITE_TOOL_LABELS,
  );
}

/** 错误条的一项：中文原因 + 重试所需的原始消息与气泡。 */
interface ChatErrorState extends ChatFailure {
  /** 失败那一轮发出的原文，重试原样重发。 */
  text: string;
  /** 失败那一轮的助手气泡 id，重试复用它而不是追加新消息。 */
  assistantId: number;
}

/** 请求层错误的载体，让状态码与错误码能参与中文分类。 */
class ChatRequestError extends Error {
  readonly code: string | null;
  readonly status: number | null;

  constructor(message: string, code: string | null = null, status: number | null = null) {
    super(message);
    this.name = 'ChatRequestError';
    this.code = code;
    this.status = status;
  }
}

/** 从 HTTP 错误体里取出 daemon 的结构化错误；非 JSON 时保持 null。 */
async function readErrorPayload(
  response: Response,
): Promise<{ code: string | null; message: string | null }> {
  try {
    const body = (await response.json()) as { error?: { code?: unknown; message?: unknown } };
    return {
      code: typeof body.error?.code === 'string' ? body.error.code : null,
      message: typeof body.error?.message === 'string' ? body.error.message : null,
    };
  } catch {
    return { code: null, message: null };
  }
}

/** 把任意抛错折进分类器；原始英文只作为分类输入。 */
function describeThrownChatFailure(cause: unknown): ChatFailure {
  if (cause instanceof ChatRequestError) {
    return describeChatFailure({
      code: cause.code,
      status: cause.status,
      message: cause.message,
    });
  }

  // fetch 在连接被拒/断网时只抛 TypeError，没有状态码。
  if (cause instanceof TypeError) {
    return describeChatFailure({ networkError: true });
  }

  return describeChatFailure({
    message: cause instanceof Error ? cause.message : null,
  });
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

/** daemon 的最终答复状态：超时/断开/中断都收束为「已超时」。 */
function answeredConfirmationStatus(
  value: unknown,
  approved: boolean,
): ChatConfirmation['status'] {
  switch (value) {
    case 'approved':
      return 'approved';
    case 'declined':
      return 'declined';
    case 'timeout':
    case 'disconnected':
    case 'interrupted':
      return 'expired';
    default:
      return approved ? 'approved' : 'declined';
  }
}

function parseFrame(frame: string): StreamPayload | null {  const data = frame
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

/** 区域帧只接受完整的矩形；坏帧直接忽略，不能把界面设成半截状态。 */
function readRegion(value: unknown): CanvasRegion | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  const { x, y, width, height } = value as Record<string, unknown>;

  if (
    typeof x !== 'number' ||
    !Number.isFinite(x) ||
    typeof y !== 'number' ||
    !Number.isFinite(y) ||
    typeof width !== 'number' ||
    !Number.isFinite(width) ||
    typeof height !== 'number' ||
    !Number.isFinite(height)
  ) {
    return null;
  }

  return { x, y, width, height };
}

export function AiChatPanel() {
  const [open, setOpen] = useState(true);
  const [input, setInput] = useState('');
  const [lastInput, setLastInput] = useState<string | null>(null);
  const [inFlight, setInFlight] = useState(false);
  const [error, setError] = useState<ChatErrorState | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const canvas = useCanvasStore((state) => state.canvas);
  const status = useCanvasStore((state) => state.status);
  const currentCanvasId = useCanvasStore((state) => state.canvas?.id ?? null);
  const currentRevision = useCanvasStore((state) => state.canvas?.revision ?? null);
  // 渲染的永远是当前画布的桶；无画布时是空序列（空态，不出历史）。
  const transcriptRecord = useChatStore((state) => state.transcripts);
  const messages =
    currentCanvasId === null ? [] : transcriptRecord[currentCanvasId] ?? [];
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
  /** 每条确认条的超时计时器，按 requestId 索引。 */
  const confirmTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  /** 已发出答复的 requestId：连点不能发两次。 */
  const answering = useRef(new Set<string>());

  /**
   * 所有写消息都落到「发起时那张画布」的桶：请求在飞时写 runCanvasId，
   * 其余写当前画布。桶的键已经表达归属，消息本身不存 canvasId（spec §6）。
   */
  const updateMessages = (updater: (previous: ChatMessage[]) => ChatMessage[]) => {
    const target = runCanvasId.current ?? currentCanvasId;
    if (target === null) {
      return;
    }
    useChatStore.getState().updateTranscript(target, updater);
  };

  useEffect(() => {
    // 切走画布即中断在飞请求：run() 的 catch 会把「已取消」写回发起时那张
    // 画布的桶，界面此时已切到新桶；旧桶的错误条也不带进新画布。
    if (abortRef.current) {
      abortRef.current.abort();
    }
    setError(null);
  }, [currentCanvasId]);

  useEffect(() => {
    const timers = confirmTimers.current;

    return () => {
      abortRef.current?.abort();

      for (const timer of timers.values()) {
        clearTimeout(timer);
      }

      timers.clear();
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
    updateMessages((previous) => {
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

  const updateConfirmation = (
    id: string,
    update: (confirmation: ChatConfirmation) => ChatConfirmation,
  ) => {
    updateMessages((previous) =>
      previous.map((message) => {
        if (!message.confirmations?.some((item) => item.id === id)) {
          return message;
        }

        return {
          ...message,
          confirmations: message.confirmations.map((item) =>
            item.id === id ? update(item) : item,
          ),
        };
      }),
    );
  };

  /** 60 秒没答复：确认条过期，按钮不可再点；daemon 同时也会拒绝这次调用。 */
  const expireConfirmation = (id: string) => {
    confirmTimers.current.delete(id);
    updateConfirmation(id, (confirmation) =>
      confirmation.status === 'pending'
        ? { ...confirmation, status: 'expired' }
        : confirmation,
    );
  };

  /** 把「删除 / 取消」送回 daemon；答复期间按钮禁用，避免重复提交。 */
  const answerConfirmation = async (
    confirmation: ChatConfirmation,
    approved: boolean,
  ) => {
    if (confirmation.status !== 'pending' || answering.current.has(confirmation.id)) {
      return;
    }

    answering.current.add(confirmation.id);
    updateConfirmation(confirmation.id, (item) => ({
      ...item,
      status: 'submitting',
      error: undefined,
    }));

    try {
      const response = await fetch('/paint/ai/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: confirmation.id,
          approved,
          // daemon 只接受与挂起请求同一张画布的答复。
          canvasId: runCanvasId.current ?? undefined,
        }),
      });

      if (response.status === 404) {
        // 已超时并被清理：显示为过期，比「提交失败」更准确。
        updateConfirmation(confirmation.id, (item) => ({
          ...item,
          status: 'expired',
        }));
        return;
      }

      if (!response.ok) {
        throw new ChatRequestError('');
      }

      const body = (await response.json()) as { status?: unknown };

      updateConfirmation(confirmation.id, (item) => ({
        ...item,
        status: answeredConfirmationStatus(body.status, approved),
        error: undefined,
      }));
    } catch {
      // 网络失败时把确认条恢复为可重试，而不是静默丢掉用户的答复。
      updateConfirmation(confirmation.id, (item) => ({
        ...item,
        status: 'pending',
        error: '确认发送失败，请重试',
      }));
    } finally {
      answering.current.delete(confirmation.id);
    }
  };

  const markAssistantCancelled = (assistantId: number) => {
    updateMessages((previous) =>
      previous.map((message) =>
        message.id === assistantId
          ? {
              ...message,
              cancelled: true,
              incomplete: false,
              // 这一轮已经中断：挂起的确认不可能再被 daemon 接受。
              confirmations: message.confirmations?.map((confirmation) =>
                confirmation.status === 'pending'
                  ? { ...confirmation, status: 'expired' }
                  : confirmation,
              ),
            }
          : message,
      ),
    );
  };

  /** 失败气泡必须明确标「未完成」，空白气泡看不出这一轮失败了。 */
  const markAssistantIncomplete = (assistantId: number) => {
    updateMessages((previous) =>
      previous.map((message) =>
        message.id === assistantId
          ? { ...message, incomplete: true, generating: false }
          : message,
      ),
    );
  };

  /** 重试前清空同一个气泡：不追加消息，也不保留上一次失败的半截回复。 */
  const resetAssistant = (assistantId: number) => {
    updateMessages((previous) =>
      previous.map((message) =>
        message.id === assistantId
          ? { id: message.id, role: 'assistant', content: '' }
          : message,
      ),
    );
  };

  const cancel = () => {
    abortRef.current?.abort();
  };

  /**
   * 回答预览请求：走已有的画布导出路径，把 PNG 回传给 daemon。
   * 失败不打断对话——daemon 会在超时后把工具结果降级为 render_unavailable。
   */
  const answerRenderRequest = (requestId: string) => {
    const imageUrl = exportActiveCanvasPng();

    if (!imageUrl) {
      return;
    }

    void postRenderResult(requestId, imageUrl).catch(() => undefined);
  };

  /**
   * 回答导出请求：复用已有的 PNG 导出与下载实现，然后把落盘的文件名与大小
   * 回传给 daemon。PNG 本体留在浏览器，不进模型上下文。
   * 失败不打断对话——daemon 会把这次工具结果降级为 export_unavailable。
   */
  const answerExportRequest = (requestId: string, canvasId: string) => {
    const dataUrl = exportActiveCanvasPng();

    if (!dataUrl) {
      void postExportResult(requestId, { error: '画布尚未准备好导出' }).catch(
        () => undefined,
      );
      return;
    }

    try {
      const current = useCanvasStore.getState().canvas;
      // 画布名只取同 id 的当前画布；切到别的画布时不冒用它的名字。
      const name = current?.id === canvasId ? displayCanvasName(current.name) : null;
      const filename = canvasPngFilename(name, canvasId);
      const bytes = dataUrlToBlob(dataUrl).size;

      downloadPng(dataUrl, filename);
      void postExportResult(requestId, { filename, bytes }).catch(() => undefined);
    } catch {
      void postExportResult(requestId, { error: '无法导出 PNG' }).catch(
        () => undefined,
      );
    }
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

    if (payload.tool) {
      const { id, name, status } = payload.tool;

      if (
        typeof id === 'string' &&
        typeof name === 'string' &&
        (status === 'running' || status === 'ok' || status === 'failed')
      ) {
        const code =
          typeof payload.tool.code === 'string' ? payload.tool.code : undefined;
        const line: ChatToolLine = {
          id,
          name,
          status,
          ...(code === undefined ? {} : { code }),
        };

        updateLastAssistant((last) => {
          const tools = last.tools ? [...last.tools] : [];
          const index = tools.findIndex((existing) => existing.id === id);

          if (index >= 0) {
            tools[index] = line;
          } else {
            tools.push(line);
          }

          return { ...last, tools };
        });
        return;
      }
    }

    if (payload.confirm) {
      const { id, title, detail } = payload.confirm;
      const approveLabel =
        typeof payload.confirm.approveLabel === 'string' &&
        payload.confirm.approveLabel.length > 0
          ? payload.confirm.approveLabel
          : undefined;

      if (
        typeof id === 'string' &&
        typeof title === 'string' &&
        typeof detail === 'string'
      ) {
        // 同一 requestId 只出现一次（重连/重复帧都不能多出一条确认条）。
        const existingTimer = confirmTimers.current.get(id);

        if (existingTimer !== undefined) {
          clearTimeout(existingTimer);
        }

        const timer = setTimeout(() => expireConfirmation(id), CONFIRM_TIMEOUT_MS);

        confirmTimers.current.set(id, timer);

        updateLastAssistant((last) => {
          const confirmations = last.confirmations ?? [];

          if (confirmations.some((item) => item.id === id)) {
            return last;
          }

          return {
            ...last,
            confirmations: [
              ...confirmations,
              {
                id,
                title,
                detail,
                ...(approveLabel === undefined ? {} : { approveLabel }),
                status: 'pending',
              },
            ],
          };
        });
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

    if (payload.renderRequest) {
      const requestId = payload.renderRequest.id;

      if (typeof requestId === 'string' && requestId.length > 0) {
        answerRenderRequest(requestId);
      }
      return;
    }

    if (payload.exportRequest) {
      const { id, canvasId } = payload.exportRequest;

      if (
        typeof id === 'string' &&
        id.length > 0 &&
        typeof canvasId === 'string' &&
        canvasId.length > 0
      ) {
        answerExportRequest(id, canvasId);
      }
      return;
    }

    if (payload.select) {
      const { canvasId, layerId, clamped } = payload.select;
      const region = readRegion(payload.select.region);

      if (typeof canvasId === 'string' && canvasId.length > 0) {
        // 纯界面信号：只更新 store，不碰画布、不落库、不抢焦点。
        useCanvasStore.getState().selectFromAi({
          canvasId,
          ...(typeof layerId === 'string' && layerId.length > 0 ? { layerId } : {}),
          ...(region === null ? {} : { region }),
          ...(clamped === true ? { clamped: true } : {}),
        });
      }
      return;
    }

    if (typeof payload.notice === 'string' && payload.notice.length > 0) {
      const notice = payload.notice;
      updateLastAssistant((last) => ({ ...last, notice }));
      return;
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
      const code =
        typeof payload.error.code === 'string' ? payload.error.code : null;
      const message =
        typeof payload.error.message === 'string' && payload.error.message.length > 0
          ? payload.error.message
          : null;
      throw new ChatRequestError(message ?? '', code);
    }
  };

  /** 跑一轮请求：发送与重试共用，区别只在重试复用已有气泡。 */
  const run = async (text: string, assistantId: number) => {
    setError(null);
    setElapsedSeconds(0);
    runStartedAt.current = Date.now();
    runStartRevision.current = useCanvasStore.getState().canvas?.revision ?? null;
    runCanvasId.current = useCanvasStore.getState().canvas?.id ?? null;
    setInFlight(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const canvasId = useCanvasStore.getState().canvas?.id;
      const response = await fetch('/paint/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, canvasId }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await readErrorPayload(response);
        throw new ChatRequestError(
          body.message ?? '',
          body.code,
          response.status,
        );
      }

      if (!response.body) {
        throw new ChatRequestError('');
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
        markAssistantCancelled(assistantId);
        return;
      }

      const failure = describeThrownChatFailure(cause);
      markAssistantIncomplete(assistantId);
      setError({ ...failure, text, assistantId });
      // 仅当输入框为空才恢复草稿；用户已经重新输入的内容不覆盖。
      setInput((current) => (current.length === 0 ? text : current));
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      runStartedAt.current = null;
      runStartRevision.current = null;
      runCanvasId.current = null;
      setInFlight(false);
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
    updateMessages((previous) => [...previous, userMessage, assistantMessage]);

    await run(message, assistantMessage.id);
  };

  /** 重试复用失败那一轮的用户消息与助手气泡，不追加新消息。 */
  const retry = () => {
    if (inFlight || error === null || !error.retryable) {
      return;
    }

    if (!useCanvasStore.getState().canvas) {
      return;
    }

    const { text, assistantId } = error;
    resetAssistant(assistantId);
    // 输入框若还是刚恢复的那一句就清空；用户改写过的草稿保持原样。
    setInput((current) => (current === text ? '' : current));
    void run(text, assistantId);
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
    layerUndoState(layer, currentCanvasId, currentRevision) === 'available';

  /** 后续 mutation 已越过 AI 这一步：只给纯文本，不给撤销入口。 */
  const isLayerStale = (layer: ChatLayerConfirmation): boolean =>
    layerUndoState(layer, currentCanvasId, currentRevision) === 'stale';

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
      updateMessages((previous) =>
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
                const text = message.content;
                const isPending =
                  inFlight &&
                  message.role === 'assistant' &&
                  message.id === lastMessageId;
                const lines = writeToolLines(message);

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
                          <span className="ai-chat__pending-label">
                            {message.generating ? '正在生成…' : '思考中…'}
                          </span>
                          <span className="ai-chat__timer">
                            已用 {elapsedSeconds}s
                          </span>
                        </span>
                      ) : null}
                      {text}
                      {message.incomplete ? (
                        <span className="ai-chat__incomplete">未完成</span>
                      ) : null}
                      {message.cancelled ? (
                        <span className="ai-chat__cancelled">已取消</span>
                      ) : null}
                    </p>
                    {/* 不可逆动作先停在这里：用户点「删除」才继续执行。 */}
                    {message.confirmations && message.confirmations.length > 0 ? (
                      <div className="ai-chat__confirmations">
                        {message.confirmations.map((confirmation) => {
                          const statusText = CONFIRM_STATUS_TEXT[confirmation.status];
                          const settled = confirmation.status !== 'pending';

                          return (
                            <div
                              key={confirmation.id}
                              className="ai-chat__confirm"
                              role="group"
                              aria-label="操作确认"
                            >
                              <p className="ai-chat__confirm-title">
                                {confirmation.title}
                              </p>
                              <p className="ai-chat__confirm-detail">
                                {confirmation.detail}
                              </p>
                              {confirmation.error ? (
                                <p className="ai-chat__confirm-error" role="alert">
                                  {confirmation.error}
                                </p>
                              ) : null}
                              <div className="ai-chat__confirm-actions">
                                <button
                                  type="button"
                                  className="ai-chat__confirm-approve"
                                  onClick={() =>
                                    void answerConfirmation(confirmation, true)
                                  }
                                  disabled={settled}
                                >
                                  {confirmation.approveLabel ?? '删除'}
                                </button>
                                <button
                                  type="button"
                                  className="ai-chat__confirm-decline"
                                  onClick={() =>
                                    void answerConfirmation(confirmation, false)
                                  }
                                  disabled={settled}
                                >
                                  取消
                                </button>
                                {statusText ? (
                                  <span className="ai-chat__confirm-status">
                                    {statusText}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                    {message.notice ? (
                      <span className="ai-chat__notice" role="status">
                        {message.notice}
                      </span>
                    ) : null}
                    {/* 写操作成行：只保留画布动作，读工具已折叠掉。 */}
                    {lines.length > 0 ? (
                      <ul className="ai-chat__writes" aria-label="画布写操作">
                        {lines.map((tool) => (
                          <li
                            key={tool.id}
                            className={`ai-chat__write-line ai-chat__write-line--${tool.status}`}
                          >
                            {toolLineText(tool)}
                          </li>
                        ))}
                      </ul>
                    ) : null}
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
            <div className="ai-chat__error" role="alert">
              <span className="ai-chat__error-text">{error.message}</span>
              {error.retryable ? (
                <button
                  type="button"
                  className="ai-chat__retry"
                  onClick={retry}
                  disabled={inFlight}
                >
                  重试
                </button>
              ) : null}
            </div>
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

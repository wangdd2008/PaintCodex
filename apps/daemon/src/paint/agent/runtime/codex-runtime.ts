import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import type { LogLevel, StreamPayload } from '@paintcodex/protocol';
import type { ObservabilityLogger, TraceContext } from '../../../observability/logger.js';
import type {
  AgentMessageDeltaNotification,
  DynamicToolCallParams,
  DynamicToolCallResponse,
  DynamicToolCallOutputContentItem,
  InitializeParams,
  InitializeResponse,
  ItemNotification,
  JsonRpcError,
  JsonRpcId,
  JsonRpcRequest,
  ThreadDeleteParams,
  ThreadResumeParams,
  ThreadResumeResult,
  ThreadStartParams,
  ThreadStartResult,
  TurnCompletedNotification,
  TurnStartParams,
  TurnStartResult,
} from './protocol.js';
import type {
  CanvasToolContext,
  CanvasToolResult,
  CanvasToolSet,
} from './tools.js';
import {
  createConfirmationChannel,
  type ConfirmFrameEvent,
  type ConfirmationCancelReason,
  type ConfirmationChannel,
  type ConfirmationOutcome,
  type ConfirmationRequest,
} from './confirmation.js';
import type {
  RenderPreviewRequester,
  RenderPreviewResult,
} from './render-preview.js';

/** One `tool` SSE frame: the protocol owns the shape so daemon and web agree. */
export type ToolFrameEvent = NonNullable<StreamPayload['tool']>;

/** One user message's worth of work inside a thread. */
export interface CodexTurnInput {
  /** Canvas of the conversation; null means a per-turn, tool-less thread. */
  canvasId: string | null;
  /** Full prompt sent to the model (canvas summary + user message). */
  prompt: string;
  /** Raw user message, stored on layers the agent creates. Defaults to `prompt`. */
  userMessage?: string;
  tools: CanvasToolSet;
  onDelta(text: string): void;
  onLayerCreated?(layer: { id: string; name: string }): void;
  /** Fires on `item/started` / `item/completed` for dynamic tool calls. */
  onToolEvent?(event: ToolFrameEvent): void;
  /** Fires when a tool suspends for a human confirmation. */
  onConfirm?(event: ConfirmFrameEvent): void;
  /**
   * Asks the browser that opened this chat stream to render the canvas. Bound
   * to the turn's abort signal by the runtime, so an interrupted turn cannot
   * leave a render request pending.
   */
  requestRender?: RenderPreviewRequester;
  /**
   * A short, non-fatal status worth showing in the assistant bubble, such as a
   * recovered conversation. The turn continues after a notice.
   */
  onNotice?(notice: string): void;
  signal?: AbortSignal;
  trace?: TraceContext;
}

export interface CodexTurnResult {
  text: string;
  toolCallCount: number;
}

export interface ActiveTurnInfo {
  threadId: string;
  turnId: string | null;
  canvasId: string | null;
}

/**
 * The only seam between the daemon and the Codex protocol. One process, one
 * thread per canvas (durable when a `CodexThreadStore` is configured), one turn
 * per user message.
 */
export interface CodexRuntime {
  startTurn(input: CodexTurnInput): Promise<CodexTurnResult>;
  /** Interrupts the active turn of a canvas; a no-op when nothing is running. */
  interrupt(canvasId: string | null): Promise<void>;
  getThreadId(canvasId: string): string | null;
  getActiveTurn(canvasId: string | null): ActiveTurnInfo | null;
  /**
   * Forgets and deletes the canvas' thread. Failures are logged, never thrown:
   * a canvas whose thread cannot be deleted must still be deletable.
   */
  deleteThread(canvasId: string): Promise<void>;
  close(): Promise<void>;
}

/**
 * Where a canvas' Codex thread id lives between daemon runs. The daemon backs it
 * with `canvases.codexThreadId`; tests use an in-memory map.
 */
export interface CodexThreadStore {
  load(canvasId: string): string | null;
  save(canvasId: string, threadId: string): void;
  clear(canvasId: string): void;
}

export type CodexVersionProbe =
  | { available: true; version: string }
  | { available: false; reason: string };

export interface CodexRuntimeOptions {
  /** Executable name or path. Defaults to `PAINTCODEX_CODEX_BIN` or `codex`/`codex.cmd`. */
  command?: string;
  /** Arguments after the executable. Defaults to `['app-server']`. */
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Sink for `codex-runtime` lifecycle events. Logging is skipped when omitted. */
  logger?: ObservabilityLogger;
  /** Per JSON-RPC request deadline (initialize / thread start / turn start). */
  requestTimeoutMs?: number;
  /** Upper bound on one tool execution before answering the model with a failure. */
  toolTimeoutMs?: number;
  /** Shared confirmation registry; created internally when omitted. */
  confirmations?: ConfirmationChannel;
  /**
   * Persists the canvas → thread mapping. Without it threads are in-memory and
   * ephemeral, which is all a test double needs.
   */
  threadStore?: CodexThreadStore;
  clientInfo?: { name: string; version: string };
  /**
   * Test seam: replaces `child_process.spawn` so process-lifecycle behaviour
   * (crash, exit codes) can be driven deterministically, without racing a real
   * child's startup against a request deadline.
   */
  spawn?: () => ChildProcess;
}

export const MINIMUM_CODEX_VERSION = '0.164.0';

const DEFAULT_ARGS = ['app-server'];
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_TOOL_TIMEOUT_MS = 30_000;
const STDERR_TAIL_LENGTH = 8_192;

function defaultCommand(): string {
  return process.platform === 'win32' ? 'codex.cmd' : 'codex';
}

function quoteForCmd(value: string): string {
  return /[\s"&|<>^]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function needsShell(command: string): boolean {
  return process.platform === 'win32' && /\.(cmd|bat)$/i.test(command);
}

export function probeCodexVersion(
  options: { command?: string; args?: string[] } = {},
): CodexVersionProbe {
  const command =
    options.command ?? process.env.PAINTCODEX_CODEX_BIN ?? defaultCommand();
  const args = options.args ?? ['--version'];
  const invocation = needsShell(command)
    ? {
        command: process.env.ComSpec ?? 'cmd.exe',
        args: ['/d', '/s', '/c', [command, ...args].map(quoteForCmd).join(' ')],
      }
    : { command, args };

  const result = spawnSync(invocation.command, invocation.args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 10_000,
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();

  if (result.error) {
    return {
      available: false,
      reason: `未找到 codex CLI（${command}），AI 功能不可用。请安装 codex CLI ${MINIMUM_CODEX_VERSION} 或更高版本。`,
    };
  }

  if (result.status !== 0 && output.length === 0) {
    return {
      available: false,
      reason: `codex --version 运行失败（退出代码 ${String(result.status)}），AI 功能不可用。请确认 codex CLI 可用。`,
    };
  }

  const match = /(\d+)\.(\d+)\.(\d+)/.exec(output);

  if (!match) {
    return {
      available: false,
      reason: `无法识别 codex CLI 版本（输出：${output.slice(0, 200)}），需要 ${MINIMUM_CODEX_VERSION} 或更高版本。`,
    };
  }

  const version = `${match[1]}.${match[2]}.${match[3]}`;

  if (!versionAtLeast(version, MINIMUM_CODEX_VERSION)) {
    return {
      available: false,
      reason: `codex CLI 版本过低（当前 ${version}，需要 ${MINIMUM_CODEX_VERSION} 或更高版本）。请运行 npm install -g @openai/codex@latest 升级。`,
    };
  }

  return { available: true, version };
}

function versionAtLeast(version: string, minimum: string): boolean {
  const actual = version.split('.').map(Number);
  const required = minimum.split('.').map(Number);

  for (let index = 0; index < required.length; index += 1) {
    const left = actual[index] ?? 0;
    const right = required[index] ?? 0;

    if (left !== right) {
      return left > right;
    }
  }

  return true;
}

interface PendingRequest {
  method: string;
  resolve(result: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

interface MutableActiveTurn extends ActiveTurnInfo {
  prompt: string;
  tools: CanvasToolSet;
  text: string;
  toolCallCount: number;
  /** Failure codes by callId, attached to the matching `item/completed` frame. */
  toolCodes: Map<string, string>;
  onDelta(text: string): void;
  onLayerCreated?: (layer: { id: string; name: string }) => void;
  onToolEvent?: (event: ToolFrameEvent) => void;
  onConfirm?: (event: ConfirmFrameEvent) => void;
  requestRender?: RenderPreviewRequester;
  onNotice?: (notice: string) => void;
  trace?: TraceContext;
  signal?: AbortSignal;
  /**
   * Cancels every human wait of this turn — a confirmation or a browser render.
   * Both channels already settle on abort, so this is the single surface the
   * runtime uses to stop waiting when the turn ends, is interrupted, or dies.
   */
  waits: AbortController;
  settled: boolean;
  abortRequested: boolean;
  resolve(result: CodexTurnResult): void;
  reject(error: Error): void;
  onAbort(): void;
}

export function createCodexRuntime(options: CodexRuntimeOptions = {}): CodexRuntime {
  const command =
    options.command ?? process.env.PAINTCODEX_CODEX_BIN ?? defaultCommand();
  const args = options.args ?? DEFAULT_ARGS;
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const toolTimeoutMs = options.toolTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;
  const threadStore = options.threadStore;
  const clientInfo = options.clientInfo ?? { name: 'paintcodex', version: '0.1.0' };
  const confirmations =
    options.confirmations ??
    createConfirmationChannel({ logger: options.logger });

  let child: ChildProcess | null = null;
  let ready: Promise<void> | null = null;
  let closing = false;
  let nextRequestId = 1;
  let stdoutBuffer = '';
  let stderrTail = '';
  /**
   * Failure of the most recent app-server process. A request timeout must not
   * mask it: if the process is already gone, the caller should see the exit
   * code, not "request timed out".
   */
  let processGone: Error | null = null;

  const pending = new Map<number, PendingRequest>();
  const threads = new Map<string, string>();
  const activeTurns = new Map<string, MutableActiveTurn>();
  /**
   * Per-thread tool queue. One turn may ask for several tools back to back, and
   * two writes racing would overwrite each other's `expectedRevision`; the
   * canvas has a single writer, so calls execute strictly one at a time.
   */
  const toolQueues = new Map<string, Promise<void>>();

  const log = (
    level: LogLevel,
    message: string,
    details: {
      payload?: unknown;
      error?: unknown;
      durationMs?: number;
      canvasId?: string | null;
      trace?: TraceContext;
    } = {},
  ) => {
    options.logger?.log({
      category: 'codex-runtime',
      level,
      message,
      payload: details.payload,
      error: details.error,
      durationMs: details.durationMs ?? null,
      canvasId: details.canvasId ?? null,
      actor: 'agent',
      traceId: details.trace?.traceId ?? null,
      parentId: details.trace?.spanId ?? null,
    });
  };

  const abortError = (message = 'AI 轮次已中断'): Error => {
    const error = new Error(message);
    error.name = 'AbortError';
    return error;
  };

  const processFailure = (exitCode: number | null, signal: string | null): Error =>
    new Error(
      `Codex app-server 进程意外退出（代码 ${exitCode ?? 'null'}${
        signal ? `，信号 ${signal}` : ''
      }${stderrTail.trim().length > 0 ? `：${stderrTail.trim().slice(-500)}` : ''}）`,
    );

  const write = (message: JsonRpcRequest | Record<string, unknown>) => {
    if (!child || !child.stdin || child.stdin.destroyed) {
      throw new Error('Codex app-server 未运行');
    }

    child.stdin.write(`${JSON.stringify(message)}\n`);
  };

  const request = <TResult>(
    method: string,
    params: unknown,
    timeoutMs = requestTimeoutMs,
  ): Promise<TResult> => {
    const id = nextRequestId++;

    return new Promise<TResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(
          processGone ?? new Error(`Codex app-server 请求超时：${method}`),
        );
      }, timeoutMs);

      pending.set(id, {
        method,
        timer,
        resolve: (result) => resolve(result as TResult),
        reject,
      });

      try {
        write({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  };

  const settle = (
    active: MutableActiveTurn,
    complete: () => void,
    cancelReason: ConfirmationCancelReason = 'interrupted',
  ): void => {
    if (active.settled) {
      return;
    }

    // A tool suspended on the human must never outlive its turn: settle the
    // confirmation first (so the recorded outcome is the real reason), then
    // abort anything else still waiting on the browser.
    if (active.canvasId !== null) {
      confirmations.cancelCanvas(active.canvasId, cancelReason);
    }

    active.waits.abort();

    active.settled = true;
    activeTurns.delete(active.threadId);
    active.signal?.removeEventListener('abort', active.onAbort);
    complete();
  };

  const sendInterrupt = async (threadId: string, turnId: string): Promise<void> => {
    try {
      await request('turn/interrupt', { threadId, turnId });
    } catch (error) {
      log('warn', 'interrupt_failed', { error });
    }
  };

  const rejectPending = (error: Error) => {
    for (const [id, entry] of pending) {
      clearTimeout(entry.timer);
      pending.delete(id);
      entry.reject(error);
    }
  };

  const failEverything = (error: Error) => {
    rejectPending(error);
    confirmations.cancelAll('interrupted');

    for (const active of [...activeTurns.values()]) {
      settle(active, () => active.reject(error));
    }
  };

  const handleResponse = (
    id: JsonRpcId,
    record: { result?: unknown; error?: JsonRpcError },
  ) => {
    if (typeof id !== 'number') {
      return;
    }

    const entry = pending.get(id);

    if (!entry) {
      return;
    }

    pending.delete(id);
    clearTimeout(entry.timer);

    if (record.error) {
      entry.reject(
        new Error(
          `Codex app-server ${entry.method} 失败：${record.error.message}`,
        ),
      );
      return;
    }

    entry.resolve(record.result);
  };

  const handleNotification = (method: string, params: unknown) => {
    if (method === 'item/agentMessage/delta') {
      const delta = params as Partial<AgentMessageDeltaNotification>;

      if (
        typeof delta.threadId !== 'string' ||
        typeof delta.delta !== 'string'
      ) {
        return;
      }

      const active = activeTurns.get(delta.threadId);

      if (!active || active.settled) {
        return;
      }

      active.text += delta.delta;

      try {
        active.onDelta(delta.delta);
      } catch (error) {
        log('error', 'delta_handler_failed', {
          error,
          canvasId: active.canvasId,
          trace: active.trace,
        });
        settle(active, () =>
          active.reject(
            error instanceof Error ? error : new Error(String(error)),
          ),
        );
      }

      return;
    }

    if (method === 'item/started' || method === 'item/completed') {
      const notification = (params ?? {}) as Partial<ItemNotification>;
      const item = notification.item;

      if (typeof item !== 'object' || item === null) {
        return;
      }

      const record = item as Record<string, unknown>;

      if (record.type !== 'dynamicToolCall') {
        return;
      }

      if (typeof notification.threadId !== 'string') {
        return;
      }

      const active = activeTurns.get(notification.threadId);

      if (!active || active.settled) {
        return;
      }

      if (typeof record.id !== 'string' || typeof record.tool !== 'string') {
        return;
      }

      const running = method === 'item/started';
      const code = running ? undefined : active.toolCodes.get(record.id);
      const event: ToolFrameEvent = {
        id: record.id,
        name: record.tool,
        status: running ? 'running' : record.success === false ? 'failed' : 'ok',
        ...(code === undefined ? {} : { code }),
      };

      try {
        active.onToolEvent?.(event);
      } catch (error) {
        log('error', 'tool_event_handler_failed', {
          error,
          canvasId: active.canvasId,
          trace: active.trace,
        });
      }

      return;
    }

    if (method === 'turn/completed') {
      const completed = params as Partial<TurnCompletedNotification>;
      const threadId = completed.threadId;

      if (typeof threadId !== 'string') {
        return;
      }

      const active = activeTurns.get(threadId);

      if (!active) {
        return;
      }

      const status = completed.turn?.status;
      const turnId = completed.turn?.id ?? active.turnId;

      if (status === 'inProgress') {
        return;
      }

      if (status === 'failed') {
        const failure = new Error(
          completed.turn?.error?.message ?? 'AI 轮次失败',
        );
        log('error', 'turn_failed', {
          payload: { threadId, turnId },
          error: failure,
          canvasId: active.canvasId,
          trace: active.trace,
        });
        settle(active, () => active.reject(failure));
        return;
      }

      if (status === 'interrupted') {
        log('warn', 'turn_interrupted', {
          payload: { threadId, turnId },
          canvasId: active.canvasId,
          trace: active.trace,
        });
        settle(active, () => active.reject(abortError()));
        return;
      }

      log('info', 'turn_complete', {
        payload: {
          threadId,
          turnId,
          status: status ?? 'completed',
          toolCallCount: active.toolCallCount,
          textLength: active.text.length,
        },
        canvasId: active.canvasId,
        trace: active.trace,
      });
      settle(active, () =>
        active.resolve({
          text: active.text,
          toolCallCount: active.toolCallCount,
        }),
      );
    }
  };

  const executeWithTimeout = async (
    active: MutableActiveTurn,
    tool: string,
    toolArgs: unknown,
  ): Promise<CanvasToolResult> => {
    let remainingMs = toolTimeoutMs;
    let runningSince = Date.now();
    let timer: NodeJS.Timeout | undefined;
    let suspendedCount = 0;
    let finished = false;
    let resolveTimeout: (result: CanvasToolResult) => void = () => {};

    const armTimer = () => {
      runningSince = Date.now();
      timer = setTimeout(() => {
        timer = undefined;

        if (finished) {
          return;
        }

        log('warn', 'tool_timeout', {
          payload: { tool, toolTimeoutMs },
          canvasId: active.canvasId,
          trace: active.trace,
        });
        resolveTimeout({
          ok: false,
          code: 'tool_timeout',
          message: `画布工具执行超时（${toolTimeoutMs}ms）`,
        });
      }, remainingMs);
    };

    // Waiting for the user is not tool compute time: the deadline is paused
    // while a confirmation is pending, so the 60s confirmation policy is not
    // silently truncated by the 30s tool budget.
    const suspendTimeout = () => {
      suspendedCount += 1;

      if (suspendedCount > 1 || finished) {
        return;
      }

      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }

      remainingMs = Math.max(0, remainingMs - (Date.now() - runningSince));
    };

    const resumeTimeout = () => {
      suspendedCount = Math.max(0, suspendedCount - 1);

      if (suspendedCount > 0 || finished || timer) {
        return;
      }

      armTimer();
    };

    const timeout = new Promise<CanvasToolResult>((resolve) => {
      resolveTimeout = resolve;
    });
    armTimer();

    const canvasId = active.canvasId;
    const waitSignal = active.waits.signal;
    const requestConfirmation =
      canvasId === null
        ? undefined
        : async (request: ConfirmationRequest): Promise<ConfirmationOutcome> => {
            if (finished) {
              // The tool already timed out; a late question would hang forever
              // with no listener.
              return 'timeout';
            }

            suspendTimeout();

            try {
              return await confirmations.requestConfirmation(canvasId, request, {
                onConfirm: active.onConfirm,
                trace: active.trace,
                signal: waitSignal,
              });
            } finally {
              resumeTimeout();
            }
          };

    const requestRender =
      active.requestRender === undefined
        ? undefined
        : async (renderCanvasId: string): Promise<RenderPreviewResult> => {
            if (finished) {
              // Like a late confirmation, a render asked for after the tool gave
              // up has nobody left to consume it.
              return {
                ok: false,
                code: 'render_unavailable',
                message: '画布工具已结束，无法请求预览',
              };
            }

            // A browser round-trip is a human wait, not tool compute: pause the
            // tool deadline with the same helper the confirmation path uses.
            suspendTimeout();

            try {
              return await active.requestRender!(renderCanvasId, waitSignal);
            } finally {
              resumeTimeout();
            }
          };

    const context: CanvasToolContext = {
      canvasId,
      prompt: active.prompt,
      trace: active.trace,
      ...(requestConfirmation === undefined ? {} : { requestConfirmation }),
      ...(requestRender === undefined ? {} : { requestRender }),
    };

    // `Promise.resolve().then` also catches a tool that throws synchronously:
    // every invocation must produce a response, or the turn hangs forever.
    const execution = Promise.resolve()
      .then(() => active.tools.execute(tool, toolArgs, context))
      .catch(
        (error: unknown): CanvasToolResult => ({
          ok: false,
          code: 'tool_failed',
          message: error instanceof Error ? error.message : '画布工具执行失败',
        }),
      );

    try {
      return await Promise.race([execution, timeout]);
    } finally {
      finished = true;

      if (timer) {
        clearTimeout(timer);
      }
    }
  };

  /** Runs `task` after every earlier tool call of the same thread finished. */
  const enqueueToolCall = (
    threadId: string,
    task: () => Promise<void>,
  ): Promise<void> => {
    const previous = toolQueues.get(threadId) ?? Promise.resolve();
    const next = previous.then(task, task);
    const tail = next.then(
      () => undefined,
      () => undefined,
    );

    toolQueues.set(threadId, tail);
    void tail.then(() => {
      if (toolQueues.get(threadId) === tail) {
        toolQueues.delete(threadId);
      }
    });

    return next;
  };

  const runToolCall = async (
    id: JsonRpcId,
    call: Partial<DynamicToolCallParams>,
  ) => {
    const active =
      typeof call.threadId === 'string' ? activeTurns.get(call.threadId) : undefined;
    let result: CanvasToolResult;

    if (typeof call.tool !== 'string') {
      result = {
        ok: false,
        code: 'invalid_arguments',
        message: '工具调用参数不完整',
      };
    } else if (!active || active.settled) {
      result = {
        ok: false,
        code: 'no_active_turn',
        message: '工具调用没有对应的进行中轮次',
      };
    } else {
      log('debug', 'tool_call', {
        payload: { tool: call.tool, callId: call.callId },
        canvasId: active.canvasId,
        trace: active.trace,
      });
      result = await executeWithTimeout(active, call.tool, call.arguments);
      active.toolCallCount += 1;

      // The matching `item/completed` notification carries success but not the
      // failure code; remember it by callId so the frame can say why.
      if (!result.ok && typeof call.callId === 'string') {
        active.toolCodes.set(call.callId, result.code);
      }

      // Only creation feeds the "layer added" confirmation; an update also
      // returns a layer so the model can see it, but nothing was added.
      const layer =
        result.ok && call.tool === 'canvas_create_layer' ? result.layer : undefined;

      if (
        typeof layer === 'object' &&
        layer !== null &&
        typeof (layer as { id?: unknown }).id === 'string' &&
        typeof (layer as { name?: unknown }).name === 'string'
      ) {
        try {
          active.onLayerCreated?.(layer as { id: string; name: string });
        } catch (error) {
          log('error', 'layer_handler_failed', {
            error,
            canvasId: active.canvasId,
            trace: active.trace,
          });
        }
      }
    }

    const response: DynamicToolCallResponse = buildToolResponse(result);

    write({ id, result: response });
  };

  const handleServerRequest = async (
    id: JsonRpcId,
    method: string,
    params: unknown,
  ) => {
    if (method !== 'item/tool/call') {
      write({
        id,
        error: { code: -32601, message: `不支持的服务端请求：${method}` },
      });
      return;
    }

    const call = (params ?? {}) as Partial<DynamicToolCallParams>;

    if (typeof call.threadId !== 'string') {
      await runToolCall(id, call);
      return;
    }

    await enqueueToolCall(call.threadId, () => runToolCall(id, call));
  };

  const handleLine = (line: string) => {
    let message: unknown;

    try {
      message = JSON.parse(line);
    } catch {
      log('warn', 'runtime_line_invalid', {
        payload: { lineLength: line.length },
      });
      return;
    }

    if (typeof message !== 'object' || message === null) {
      log('warn', 'runtime_line_invalid', {
        payload: { lineLength: line.length },
      });
      return;
    }

    const record = message as {
      id?: JsonRpcId;
      method?: unknown;
      params?: unknown;
      result?: unknown;
      error?: JsonRpcError;
    };
    const hasId = typeof record.id === 'number' || typeof record.id === 'string';
    const method = typeof record.method === 'string' ? record.method : null;

    if (method !== null && hasId) {
      void handleServerRequest(record.id as JsonRpcId, method, record.params).catch(
        (error: unknown) => {
          log('error', 'runtime_server_request_failed', {
            error,
            payload: { method },
          });
        },
      );
      return;
    }

    if (method !== null) {
      handleNotification(method, record.params);
      return;
    }

    if (hasId) {
      handleResponse(record.id as JsonRpcId, record);
      return;
    }

    log('warn', 'runtime_message_invalid', {
      payload: { keys: Object.keys(record).slice(0, 8) },
    });
  };

  const drainStdout = () => {
    let newline = stdoutBuffer.indexOf('\n');

    while (newline >= 0) {
      const line = stdoutBuffer.slice(0, newline).replace(/\r$/, '');
      stdoutBuffer = stdoutBuffer.slice(newline + 1);

      if (line.trim().length > 0) {
        handleLine(line);
      }

      newline = stdoutBuffer.indexOf('\n');
    }
  };

  const attachProcess = (process: ChildProcess) => {
    // `error`, `exit` and `close` can all report the same death; the first one
    // wins so pending requests are rejected exactly once, immediately.
    let settled = false;

    const finish = (failure: Error, message: string) => {
      if (settled) {
        return;
      }

      settled = true;
      processGone = failure;

      if (child === process) {
        child = null;
        ready = null;
        threads.clear();
      }

      if (!closing) {
        log('error', message, {
          payload: {
            exitCode: process.exitCode,
            signal: process.signalCode,
            stderr: stderrTail.trim().slice(-500),
          },
          error: failure,
        });
      }

      failEverything(failure);
    };

    process.stdout?.setEncoding('utf8');
    process.stdout?.on('data', (chunk: string) => {
      stdoutBuffer += chunk;
      drainStdout();
    });

    process.stderr?.setEncoding('utf8');
    process.stderr?.on('data', (chunk: string) => {
      stderrTail = `${stderrTail}${chunk}`.slice(-STDERR_TAIL_LENGTH);
    });

    process.stdin?.on('error', () => {
      // The process may already be gone; exit handling reports the real cause.
    });

    process.on('error', (error) => {
      finish(error, 'runtime_process_error');
    });

    // `exit` fires before `close` on Windows, so pending requests see the exit
    // code even when stdio draining delays the close event.
    process.on('exit', (code, signal) => {
      finish(processFailure(code, signal), 'runtime_exit');
    });

    process.on('close', (code, signal) => {
      finish(processFailure(code, signal), 'runtime_exit');
    });
  };

  /**
   * Resolves once the OS has actually started the process. Request deadlines
   * only make sense from that point: on a loaded machine the spawn itself can
   * take seconds, and a request timeout must not fire before the process it is
   * waiting on exists.
   */
  const waitForSpawn = (process: ChildProcess): Promise<void> =>
    new Promise((resolve, reject) => {
      if (process.exitCode !== null) {
        resolve();
        return;
      }

      const cleanup = () => {
        process.off('spawn', onSpawn);
        process.off('error', onError);
        process.off('exit', onExit);
      };
      const onSpawn = () => {
        cleanup();
        resolve();
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
        cleanup();
        reject(processFailure(code, signal));
      };

      process.once('spawn', onSpawn);
      process.once('error', onError);
      process.once('exit', onExit);
    });

  const spawnProcess = (): ChildProcess => {
    const spawnOptions = {
      cwd: options.cwd ?? process.cwd(),
      env: options.env ?? process.env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'] as ['pipe', 'pipe', 'pipe'],
    };

    if (!needsShell(command)) {
      return spawn(command, args, spawnOptions);
    }

    const shellCommand = [command, ...args].map(quoteForCmd).join(' ');

    return spawn(
      process.env.ComSpec ?? 'cmd.exe',
      ['/d', '/s', '/c', shellCommand],
      spawnOptions,
    );
  };

  const launchProcess = options.spawn ?? spawnProcess;

  const ensureReady = async (): Promise<void> => {
    if (closing) {
      throw new Error('Codex runtime 已关闭');
    }

    if (ready) {
      return ready;
    }

    ready = (async () => {
      const process = launchProcess();
      child = process;
      processGone = null;
      stdoutBuffer = '';
      stderrTail = '';
      attachProcess(process);

      log('info', 'runtime_spawn', {
        payload: { command, argCount: args.length },
      });

      try {
        await waitForSpawn(process);

        if (process.exitCode !== null) {
          throw processGone ?? processFailure(process.exitCode, process.signalCode);
        }

        const params: InitializeParams = {
          clientInfo,
          capabilities: { experimentalApi: true },
        };
        const result = await request<InitializeResponse>('initialize', params);
        log('info', 'runtime_ready', {
          payload: {
            userAgent: result.userAgent,
            platformFamily: result.platformFamily,
          },
        });
      } catch (error) {
        failEverything(
          error instanceof Error ? error : new Error(String(error)),
        );

        if (process.exitCode === null && process.signalCode === null) {
          terminate(process);
        }

        throw error;
      }
    })().catch((error: unknown) => {
      ready = null;
      throw error;
    });

    return ready;
  };

  const threadParams = (
    tools: CanvasToolSet,
    persistent: boolean,
  ): ThreadStartParams => ({
    cwd: options.cwd ?? process.cwd(),
    sandbox: 'read-only',
    approvalPolicy: 'never',
    // A thread can only be resumed from disk, so persistence is exactly what
    // makes `ephemeral: true` wrong.
    ephemeral: !persistent,
    dynamicTools: tools.declarations,
  });

  const startThread = async (
    tools: CanvasToolSet,
    persistent: boolean,
  ): Promise<string> => {
    const result = await request<ThreadStartResult>(
      'thread/start',
      threadParams(tools, persistent),
    );

    return result.thread.id;
  };

  /**
   * Resolves the canvas' thread, in order: the in-memory map (same daemon run),
   * the persisted id (`thread/resume`, daemon restart), a brand new thread.
   *
   * A resume that the server rejects (thread deleted or archived) must not fail
   * the user's message: start over, persist the new id, and say so.
   */
  const ensureThread = async (
    canvasId: string,
    tools: CanvasToolSet,
    onNotice?: (notice: string) => void,
  ): Promise<string> => {
    const existing = threads.get(canvasId);

    if (existing) {
      return existing;
    }

    const stored = threadStore?.load(canvasId) ?? null;

    if (stored !== null) {
      try {
        const resumed = await request<ThreadResumeResult>('thread/resume', {
          threadId: stored,
          cwd: options.cwd ?? process.cwd(),
          sandbox: 'read-only',
          approvalPolicy: 'never',
        } satisfies ThreadResumeParams);
        const threadId = resumed.thread.id;

        threads.set(canvasId, threadId);

        if (threadId !== stored) {
          threadStore?.save(canvasId, threadId);
        }

        log('info', 'thread_resume', {
          payload: { threadId, sandbox: 'read-only', toolCount: tools.declarations.length },
          canvasId,
        });
        return threadId;
      } catch (error) {
        log('warn', 'thread_resume_failed', {
          payload: { threadId: stored },
          error,
          canvasId,
        });
      }
    }

    const threadId = await startThread(tools, threadStore !== undefined);

    threads.set(canvasId, threadId);
    threadStore?.save(canvasId, threadId);
    log('info', 'thread_start', {
      payload: {
        threadId,
        sandbox: 'read-only',
        toolCount: tools.declarations.length,
        ephemeral: threadStore === undefined,
      },
      canvasId,
    });

    if (stored !== null) {
      try {
        onNotice?.('会话已重置，已开启新对话。');
      } catch (error) {
        log('warn', 'notice_handler_failed', { error, canvasId });
      }
    }

    return threadId;
  };

  const interrupt = async (canvasId: string | null): Promise<void> => {
    const active = [...activeTurns.values()].find(
      (turn) => turn.canvasId === canvasId,
    );

    if (!active || active.turnId === null) {
      return;
    }

    // Do not wait for the `turn/completed` round-trip: the suspended tool must
    // stop waiting for the human the moment the turn is cancelled.
    if (canvasId !== null) {
      confirmations.cancelCanvas(canvasId, 'interrupted');
    }

    // Stop a pending render too: no answer can be useful once the turn is gone.
    active.waits.abort();

    await sendInterrupt(active.threadId, active.turnId);
  };

  /**
   * Deletes the thread of a canvas on the server and forgets it locally. The
   * delete is best-effort: losing the conversation history is acceptable,
   * blocking the canvas delete is not.
   */
  const deleteThread = async (canvasId: string): Promise<void> => {
    const threadId = threads.get(canvasId) ?? threadStore?.load(canvasId) ?? null;

    threads.delete(canvasId);
    threadStore?.clear(canvasId);

    if (threadId === null || !child) {
      if (threadId !== null) {
        log('warn', 'thread_delete_skipped', {
          payload: { threadId, reason: 'app_server_not_running' },
          canvasId,
        });
      }
      return;
    }

    try {
      await request('thread/delete', { threadId } satisfies ThreadDeleteParams);
      log('info', 'thread_delete', {
        payload: { threadId },
        canvasId,
      });
    } catch (error) {
      log('warn', 'thread_delete_failed', {
        payload: { threadId },
        error,
        canvasId,
      });
    }
  };

  const close = async (): Promise<void> => {
    closing = true;
    ready = null;
    threads.clear();

    const shutdownError = abortError('Codex runtime 已关闭');
    failEverything(shutdownError);

    const process = child;
    child = null;

    if (!process || process.exitCode !== null || process.signalCode !== null) {
      return;
    }

    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 1_000);
      process.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
      terminate(process);
    });
  };

  return {
    async startTurn(input) {
      await ensureReady();

      let threadId: string | null =
        input.canvasId === null ? null : (threads.get(input.canvasId) ?? null);

      if (threadId === null) {
        threadId =
          input.canvasId === null
            ? await startThread(input.tools, false)
            : await ensureThread(input.canvasId, input.tools, input.onNotice);
      }

      if (activeTurns.has(threadId)) {
        throw new Error('该画布已有进行中的 AI 轮次');
      }

      const active: MutableActiveTurn = {
        threadId,
        turnId: null,
        canvasId: input.canvasId,
        prompt: input.userMessage ?? input.prompt,
        tools: input.tools,
        text: '',
        toolCallCount: 0,
        toolCodes: new Map(),
        onDelta: input.onDelta,
        onLayerCreated: input.onLayerCreated,
        onToolEvent: input.onToolEvent,
        onConfirm: input.onConfirm,
        requestRender: input.requestRender,
        onNotice: input.onNotice,
        trace: input.trace,
        settled: false,
        abortRequested: false,
        resolve: () => {},
        reject: () => {},
        onAbort: () => {},
        signal: input.signal,
        waits: new AbortController(),
      };
      const outcome = new Promise<CodexTurnResult>((resolve, reject) => {
        active.resolve = resolve;
        active.reject = reject;
      });
      // A rejected outcome may be observed only after the turn/start request
      // settles; keep Node from reporting it as unhandled in the meantime.
      void outcome.catch(() => {});

      active.onAbort = () => {
        active.abortRequested = true;

        if (active.turnId !== null) {
          void sendInterrupt(active.threadId, active.turnId);
        }

        if (active.canvasId !== null) {
          confirmations.cancelCanvas(active.canvasId, 'disconnected');
        }

        settle(active, () => active.reject(abortError()), 'disconnected');
      };

      activeTurns.set(threadId, active);

      if (input.signal?.aborted) {
        active.onAbort();
        return outcome;
      }

      input.signal?.addEventListener('abort', active.onAbort, { once: true });

      try {
        const params: TurnStartParams = {
          threadId,
          input: [{ type: 'text', text: input.prompt }],
        };
        const started = await request<TurnStartResult>('turn/start', params);
        active.turnId = started.turn.id;

        if (active.abortRequested) {
          // The abort arrived while turn/start was in flight; stop the turn now
          // that its id is known.
          void sendInterrupt(active.threadId, started.turn.id);
        } else {
          log('info', 'turn_start', {
            payload: {
              threadId,
              turnId: started.turn.id,
              promptLength: input.prompt.length,
            },
            canvasId: input.canvasId,
            trace: input.trace,
          });
        }
      } catch (error) {
        settle(active, () =>
          active.reject(error instanceof Error ? error : new Error(String(error))),
        );
      }

      return outcome;
    },

    interrupt,

    getThreadId(canvasId) {
      return threads.get(canvasId) ?? null;
    },

    getActiveTurn(canvasId) {
      const active = [...activeTurns.values()].find(
        (turn) => turn.canvasId === canvasId,
      );

      return active ?? null;
    },

    deleteThread,

    close,
  };
}

/**
 * Turns a tool result into what the model receives. A rendered preview travels
 * as an `inputImage` item — the only content kind the model can actually look
 * at — while every other result stays readable JSON text.
 */
function buildToolResponse(result: CanvasToolResult): DynamicToolCallResponse {
  const imageUrl =
    result.ok &&
    typeof result.imageUrl === 'string' &&
    result.imageUrl.length > 0
      ? result.imageUrl
      : null;
  const contentItems: DynamicToolCallOutputContentItem[] = [];

  if (imageUrl === null) {
    contentItems.push({ type: 'inputText', text: JSON.stringify(result) });
  } else {
    // The base64 image would be duplicated token-by-token inside the text.
    const text: Record<string, unknown> = { ...result };
    delete text.imageUrl;
    contentItems.push({ type: 'inputText', text: JSON.stringify(text) });
    contentItems.push({ type: 'inputImage', imageUrl });
  }

  return { success: result.ok, contentItems };
}

function terminate(proc: ChildProcess): void {
  if (!proc.pid) {
    return;
  }

  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(proc.pid), '/t', '/f'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    killer.on('error', () => {
      proc.kill();
    });
    killer.unref();
    return;
  }

  proc.kill('SIGTERM');
}

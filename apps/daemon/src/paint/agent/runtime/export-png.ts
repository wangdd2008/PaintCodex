import { randomUUID } from 'node:crypto';

/**
 * The browser cannot be asked to export forever: a closed tab or a lost stream
 * would otherwise suspend the tool until the turn dies. Same deadline as the
 * preview round-trip, which is the other browser round-trip of a turn.
 */
export const DEFAULT_EXPORT_TIMEOUT_MS = 10_000;

/** Windows rejects long names; the browser's own filename logic stays well below. */
export const MAX_EXPORT_FILENAME_LENGTH = 255;

/** An export request as it travels to the browser over the chat SSE stream. */
export interface ExportRequest {
  id: string;
  canvasId: string;
}

/**
 * What `canvas_export_png` gets back. The PNG itself never returns: the browser
 * already downloaded it, so the model only learns the name and the size.
 */
export type ExportResult =
  | { ok: true; filename: string; bytes: number }
  | { ok: false; code: 'export_unavailable' | 'export_busy'; message: string };

/** Asks the browser that owns the canvas to download it as a PNG. */
export type ExportRequester = (
  canvasId: string,
  signal?: AbortSignal,
) => Promise<ExportResult>;

/**
 * What the browser reports for one request: either the file it downloaded, or
 * why it could not export. A silent browser is handled by the deadline.
 */
export type ExportReport =
  | { filename: string; bytes: number }
  | { error: string };

/** The delivery outcome of `POST /paint/ai/export-result`. */
export type ExportDelivery =
  | { status: 'accepted' }
  | { status: 'unknown' }
  | { status: 'invalid' };

/** One open AI chat stream: export requests emitted on it, and their cleanup. */
export interface ExportTurn {
  request(canvasId: string, signal?: AbortSignal): Promise<ExportResult>;
  /** Disconnect / turn end: every pending export resolves as unavailable. */
  close(): void;
}

export interface ExportChannel {
  beginTurn(emit: (request: ExportRequest) => void): ExportTurn;
  deliver(requestId: string, report: ExportReport): ExportDelivery;
}

interface PendingExport {
  request: ExportRequest;
  resolve(result: ExportResult): void;
  timer: NodeJS.Timeout | null;
  onAbort: (() => void) | null;
  signal: AbortSignal | null;
  settled: boolean;
}

export interface ExportChannelOptions {
  timeoutMs?: number;
  /** Injectable id source; tests pin it to prove request/result correlation. */
  createId?: () => string;
}

function unavailable(message = '画布导出不可用（浏览器没有返回导出结果）'): ExportResult {
  return { ok: false, code: 'export_unavailable', message };
}

function busy(): ExportResult {
  return {
    ok: false,
    code: 'export_busy',
    message: '这张画布已经有一个导出在进行，请等它结束',
  };
}

/**
 * Request/response pairing for the canvas export.
 *
 * The shape mirrors `render-preview.ts`: the daemon generates one unguessable
 * id per request, emits it on the chat's SSE stream, and accepts exactly one
 * report for it. The report carries a filename and a byte count, never an
 * image, so this is a separate channel rather than a second result endpoint.
 * A canvas has at most one pending export, so two tool calls cannot race two
 * downloads of the same canvas.
 */
export function createExportChannel(
  options: ExportChannelOptions = {},
): ExportChannel {
  const timeoutMs = options.timeoutMs ?? DEFAULT_EXPORT_TIMEOUT_MS;
  const createId = options.createId ?? randomUUID;
  const pending = new Map<string, PendingExport>();

  const settle = (entry: PendingExport, result: ExportResult): void => {
    if (entry.settled) {
      return;
    }

    entry.settled = true;

    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }

    if (entry.onAbort && entry.signal) {
      entry.signal.removeEventListener('abort', entry.onAbort);
      entry.onAbort = null;
    }

    pending.delete(entry.request.id);
    entry.resolve(result);
  };

  const exportingCanvas = (canvasId: string): boolean => {
    for (const entry of pending.values()) {
      if (entry.request.canvasId === canvasId) {
        return true;
      }
    }

    return false;
  };

  const beginTurn = (emit: (request: ExportRequest) => void): ExportTurn => {
    const ofTurn = new Set<string>();
    let closed = false;

    const failTurn = (message: string): void => {
      for (const requestId of [...ofTurn]) {
        const entry = pending.get(requestId);

        if (entry) {
          settle(entry, unavailable(message));
        } else {
          ofTurn.delete(requestId);
        }
      }
    };

    return {
      request(canvasId, signal) {
        if (closed) {
          return Promise.resolve(unavailable('这一轮对话已结束，无法导出画布'));
        }

        if (signal?.aborted === true) {
          return Promise.resolve(unavailable('这一轮对话已取消，无法导出画布'));
        }

        if (exportingCanvas(canvasId)) {
          return Promise.resolve(busy());
        }

        const request: ExportRequest = { id: createId(), canvasId };

        return new Promise<ExportResult>((resolve) => {
          const entry: PendingExport = {
            request,
            resolve,
            timer: null,
            onAbort: null,
            signal: signal ?? null,
            settled: false,
          };

          pending.set(request.id, entry);
          ofTurn.add(request.id);

          entry.timer = setTimeout(() => {
            entry.timer = null;
            settle(
              entry,
              unavailable(`浏览器未在 ${timeoutMs}ms 内完成画布导出`),
            );
          }, timeoutMs);
          // A hanging export must not keep the daemon process alive.
          entry.timer.unref?.();

          if (signal) {
            entry.onAbort = () => {
              settle(entry, unavailable('这一轮对话已取消，无法导出画布'));
            };
            signal.addEventListener('abort', entry.onAbort, { once: true });
          }

          try {
            emit(request);
          } catch {
            settle(entry, unavailable('画布导出请求无法发送到浏览器'));
          }
        });
      },

      close() {
        closed = true;
        failTurn('这一轮对话已结束，无法导出画布');
      },
    };
  };

  return {
    beginTurn,

    deliver(requestId, report) {
      const entry = pending.get(requestId);

      if (!entry) {
        return { status: 'unknown' };
      }

      if ('error' in report) {
        if (typeof report.error !== 'string' || report.error.length === 0) {
          return { status: 'invalid' };
        }

        settle(entry, unavailable('浏览器无法导出画布'));
        return { status: 'accepted' };
      }

      const { filename, bytes } = report;

      if (
        typeof filename !== 'string' ||
        filename.trim().length === 0 ||
        filename.length > MAX_EXPORT_FILENAME_LENGTH ||
        typeof bytes !== 'number' ||
        !Number.isSafeInteger(bytes) ||
        bytes < 0
      ) {
        return { status: 'invalid' };
      }

      settle(entry, { ok: true, filename, bytes });
      return { status: 'accepted' };
    },
  };
}

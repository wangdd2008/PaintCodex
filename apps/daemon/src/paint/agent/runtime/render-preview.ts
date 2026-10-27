import { randomUUID } from 'node:crypto';

/**
 * Upper bound on one preview image. The browser posts a PNG data URL; a
 * 1920x1080 canvas export is a few hundred kilobytes, so anything near this
 * cap is a bug (or an attempt to make the daemon hold an unbounded body).
 */
export const MAX_RENDER_IMAGE_BYTES = 8 * 1024 * 1024;

export const DEFAULT_RENDER_TIMEOUT_MS = 10_000;

const PNG_DATA_URL_PREFIX = 'data:image/png;base64,';

/** A render request as it travels to the browser over the chat SSE stream. */
export interface RenderPreviewRequest {
  id: string;
  canvasId: string;
}

/**
 * What `canvas_render_preview` gets back. The failure is a tool result the
 * model can read, never an exception: the turn has to keep going.
 */
export type RenderPreviewResult =
  | { ok: true; imageUrl: string }
  | { ok: false; code: 'render_unavailable'; message: string };

/** Asks the browser that owns the canvas to render it. */
export type RenderPreviewRequester = (
  canvasId: string,
  signal?: AbortSignal,
) => Promise<RenderPreviewResult>;

/** The delivery outcome of `POST /paint/ai/render-result`. */
export type RenderResultDelivery =
  | { status: 'accepted' }
  | { status: 'unknown' }
  | { status: 'invalid' }
  | { status: 'too_large'; maxBytes: number };

/** One open AI chat stream: render requests emitted on it, and their cleanup. */
export interface RenderTurn {
  request(canvasId: string, signal?: AbortSignal): Promise<RenderPreviewResult>;
  /** Disconnect / turn end: every pending request resolves as unavailable. */
  close(): void;
}

export interface RenderPreviewChannel {
  beginTurn(emit: (request: RenderPreviewRequest) => void): RenderTurn;
  deliver(requestId: string, imageUrl: string): RenderResultDelivery;
}

interface PendingRender {
  request: RenderPreviewRequest;
  resolve(result: RenderPreviewResult): void;
  timer: NodeJS.Timeout | null;
  onAbort: (() => void) | null;
  signal: AbortSignal | null;
  settled: boolean;
}

export interface RenderPreviewChannelOptions {
  timeoutMs?: number;
  maxImageBytes?: number;
  /** Injectable id source; tests pin it to prove request/result correlation. */
  createId?: () => string;
}

function unavailable(message = '画布预览不可用（浏览器没有返回渲染结果）'): RenderPreviewResult {
  return { ok: false, code: 'render_unavailable', message };
}

/**
 * Request/response pairing for the canvas preview.
 *
 * The daemon generates one unguessable id per request, emits it on the chat's
 * SSE stream, and accepts exactly one `POST /paint/ai/render-result` for it.
 * A pending entry is removed the moment it settles, so a replayed or delayed
 * result can never satisfy a newer request; it is merely `unknown`.
 */
export function createRenderPreviewChannel(
  options: RenderPreviewChannelOptions = {},
): RenderPreviewChannel {
  const timeoutMs = options.timeoutMs ?? DEFAULT_RENDER_TIMEOUT_MS;
  const maxImageBytes = options.maxImageBytes ?? MAX_RENDER_IMAGE_BYTES;
  const createId = options.createId ?? randomUUID;
  const pending = new Map<string, PendingRender>();

  const settle = (entry: PendingRender, result: RenderPreviewResult): void => {
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

  const beginTurn = (emit: (request: RenderPreviewRequest) => void): RenderTurn => {
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
          return Promise.resolve(unavailable('这一轮对话已结束，无法渲染画布'));
        }

        if (signal?.aborted === true) {
          return Promise.resolve(unavailable('这一轮对话已取消，无法渲染画布'));
        }

        const request: RenderPreviewRequest = { id: createId(), canvasId };

        return new Promise<RenderPreviewResult>((resolve) => {
          const entry: PendingRender = {
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
              unavailable(`浏览器未在 ${timeoutMs}ms 内返回画布预览`),
            );
          }, timeoutMs);
          // A hanging render must not keep the daemon process alive.
          entry.timer.unref?.();

          if (signal) {
            entry.onAbort = () => {
              settle(entry, unavailable('这一轮对话已取消，无法渲染画布'));
            };
            signal.addEventListener('abort', entry.onAbort, { once: true });
          }

          try {
            emit(request);
          } catch {
            settle(entry, unavailable('画布预览请求无法发送到浏览器'));
          }
        });
      },

      close() {
        closed = true;
        failTurn('这一轮对话已结束，无法渲染画布');
      },
    };
  };

  return {
    beginTurn,

    deliver(requestId, imageUrl) {
      const entry = pending.get(requestId);

      if (!entry) {
        return { status: 'unknown' };
      }

      if (typeof imageUrl !== 'string' || !imageUrl.startsWith(PNG_DATA_URL_PREFIX)) {
        return { status: 'invalid' };
      }

      const bytes = Buffer.byteLength(imageUrl, 'utf8');

      if (bytes > maxImageBytes) {
        settle(entry, unavailable('画布预览图片超过大小上限'));
        return { status: 'too_large', maxBytes: maxImageBytes };
      }

      settle(entry, { ok: true, imageUrl });
      return { status: 'accepted' };
    },
  };
}

import type { SnapshotChangedEvent } from '@paintcodex/protocol';
import type { TraceContext } from '../observability/logger.js';

/**
 * 监听画布快照变更。`trace` 携带触发这次写入的追踪（AI 工具的 turn span 或
 * REST 的 HTTP span），只用于把 `sse_publish` 日志归回同一追踪；浏览器收到的
 * 事件体仍只有 `{ type, canvasId, revision }`，协议不变。
 */
export type CanvasEventListener = (
  event: SnapshotChangedEvent,
  trace?: TraceContext,
) => void;

/**
 * In-process pub/sub for canvas snapshots. Every mutation publishes here so
 * SSE subscribers can refetch the authoritative canvas state.
 */
export class PaintEvents {
  private readonly listeners = new Map<string, Set<CanvasEventListener>>();

  publishSnapshot(canvasId: string, revision: number, trace?: TraceContext): void {
    const event: SnapshotChangedEvent = {
      type: 'snapshot_changed',
      canvasId,
      revision,
    };

    for (const listener of this.listeners.get(canvasId) ?? []) {
      listener(event, trace);
    }
  }

  subscribe(canvasId: string, listener: CanvasEventListener): () => void {
    let listeners = this.listeners.get(canvasId);

    if (!listeners) {
      listeners = new Set();
      this.listeners.set(canvasId, listeners);
    }

    listeners.add(listener);

    return () => {
      listeners.delete(listener);

      if (listeners.size === 0) {
        this.listeners.delete(canvasId);
      }
    };
  }
}

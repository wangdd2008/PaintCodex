import type { SnapshotChangedEvent } from '@paintcodex/protocol';

export type CanvasEventListener = (event: SnapshotChangedEvent) => void;

/**
 * In-process pub/sub for canvas snapshots. Every mutation publishes here so
 * SSE subscribers can refetch the authoritative canvas state.
 */
export class PaintEvents {
  private readonly listeners = new Map<string, Set<CanvasEventListener>>();

  publishSnapshot(canvasId: string, revision: number): void {
    const event: SnapshotChangedEvent = {
      type: 'snapshot_changed',
      canvasId,
      revision,
    };

    for (const listener of this.listeners.get(canvasId) ?? []) {
      listener(event);
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

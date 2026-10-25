import type { SnapshotChangedEvent } from '@paintcodex/protocol';

export interface CanvasEventHandlers {
  onOpen?: () => void;
  onSnapshotChanged?: (event: SnapshotChangedEvent) => void;
  onError?: () => void;
}

export function subscribeToCanvas(
  canvasId: string,
  handlers: CanvasEventHandlers,
): () => void {
  const source = new EventSource(
    `/paint/canvas/${encodeURIComponent(canvasId)}/events`,
  );

  source.onopen = () => handlers.onOpen?.();

  source.addEventListener('snapshot_changed', (event) => {
    try {
      const payload = JSON.parse(
        (event as MessageEvent<string>).data,
      ) as SnapshotChangedEvent;
      handlers.onSnapshotChanged?.(payload);
    } catch {
      // Ignore malformed payloads; the next reconnect refetches the canvas.
    }
  });

  source.onerror = () => handlers.onError?.();

  return () => source.close();
}

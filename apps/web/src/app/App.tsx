import { useEffect } from 'react';
import { AiChatPanel } from '../features/ai-chat/AiChatPanel';
import { CanvasStage } from '../features/canvas/CanvasStage';
import { LayerPanel } from '../features/layer-panel/LayerPanel';
import { Toolbox } from '../features/toolbox/Toolbox';
import { subscribeToCanvas } from '../runtime/paint-sse';
import { readRememberedCanvasId, useCanvasStore } from '../services/canvas-store';

export function App() {
  const canvas = useCanvasStore((state) => state.canvas);
  const status = useCanvasStore((state) => state.status);
  const error = useCanvasStore((state) => state.error);
  const createNewCanvas = useCanvasStore((state) => state.createNewCanvas);
  const loadCanvas = useCanvasStore((state) => state.loadCanvas);
  const refreshCanvas = useCanvasStore((state) => state.refreshCanvas);

  useEffect(() => {
    const canvasId = readRememberedCanvasId();

    if (canvasId) {
      void loadCanvas(canvasId);
    }
  }, [loadCanvas]);

  const canvasId = canvas?.id;

  useEffect(() => {
    if (!canvasId) {
      return;
    }

    return subscribeToCanvas(canvasId, {
      onOpen: () => void refreshCanvas(),
      onSnapshotChanged: (event) => {
        const current = useCanvasStore.getState().canvas;

        if (
          current &&
          current.id === event.canvasId &&
          event.revision > current.revision
        ) {
          void refreshCanvas();
        }
      },
    });
  }, [canvasId, refreshCanvas]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) {
        return;
      }

      const target = event.target as HTMLElement | null;

      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }

      const store = useCanvasStore.getState();

      if (!store.canvas) {
        return;
      }

      const key = event.key.toLowerCase();

      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        void store.undo();
        return;
      }

      if (key === 'y' || (key === 'z' && event.shiftKey)) {
        event.preventDefault();
        void store.redo();
      }
    }

    window.addEventListener('keydown', handleKeyDown);

    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="app-shell">
      <header className="menu-bar">
        <span className="brand">PaintCodex</span>
        {canvas ? <span className="document-name">{canvas.name}</span> : null}
        <span className="menu-spacer" />
        {error ? <span className="menu-status">{error}</span> : null}
        <button
          type="button"
          className="menu-button"
          onClick={() => void createNewCanvas()}
          disabled={status === 'loading'}
        >
          {status === 'loading' ? 'Working…' : 'New Canvas'}
        </button>
        <button type="button" className="menu-button" disabled>
          Export PNG
        </button>
      </header>

      <div className="workspace">
        <Toolbox />
        <main className="canvas-area">
          <CanvasStage key={canvas?.id ?? 'blank'} />
        </main>
        <aside className="side-panel">
          <LayerPanel />
          <AiChatPanel />
        </aside>
      </div>

      <footer className="status-bar">
        <span>{canvas ? `${canvas.width} × ${canvas.height}` : 'No canvas'}</span>
        <span>Zoom: 100%</span>
        <span>Brush</span>
      </footer>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { AiChatPanel } from '../features/ai-chat/AiChatPanel';
import { CanvasStage } from '../features/canvas/CanvasStage';
import { LayerPanel } from '../features/layer-panel/LayerPanel';
import { Toolbox } from '../features/toolbox/Toolbox';
import { exportActiveCanvasPng } from '../services/canvas-engine';
import { readRememberedCanvasId, useCanvasStore } from '../services/canvas-store';
import { canvasPngFilename, downloadPng } from '../services/png-export';

export function App() {
  const canvas = useCanvasStore((state) => state.canvas);
  const status = useCanvasStore((state) => state.status);
  const error = useCanvasStore((state) => state.error);
  const createNewCanvas = useCanvasStore((state) => state.createNewCanvas);
  const loadCanvas = useCanvasStore((state) => state.loadCanvas);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    const canvasId = readRememberedCanvasId();

    if (canvasId) {
      void loadCanvas(canvasId);
    }
  }, [loadCanvas]);

  const handleExportPng = () => {
    if (!canvas) {
      return;
    }

    try {
      const dataUrl = exportActiveCanvasPng();

      if (!dataUrl) {
        throw new Error('Canvas is not ready to export');
      }

      downloadPng(dataUrl, canvasPngFilename(canvas.name));
      setExportError(null);
    } catch (error) {
      setExportError(
        error instanceof Error ? error.message : 'Could not export PNG',
      );
    }
  };

  const menuMessage = error ?? exportError;

  return (
    <div className="app-shell">
      <header className="menu-bar">
        <span className="brand">PaintCodex</span>
        {canvas ? <span className="document-name">{canvas.name}</span> : null}
        <span className="menu-spacer" />
        {menuMessage ? <span className="menu-status">{menuMessage}</span> : null}
        <button
          type="button"
          className="menu-button"
          onClick={() => void createNewCanvas()}
          disabled={status === 'loading'}
        >
          {status === 'loading' ? 'Working…' : 'New Canvas'}
        </button>
        <button
          type="button"
          className="menu-button"
          onClick={handleExportPng}
          disabled={!canvas}
        >
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

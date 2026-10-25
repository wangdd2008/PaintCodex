import { useEffect, useState } from 'react';
import { AiChatPanel } from '../features/ai-chat/AiChatPanel';
import { CanvasStage } from '../features/canvas/CanvasStage';
import { LayerPanel } from '../features/layer-panel/LayerPanel';
import { MonitorPage } from '../features/monitor/MonitorPage';
import { Toolbox } from '../features/toolbox/Toolbox';
import { subscribeToCanvas } from '../runtime/paint-sse';
import { exportActiveCanvasPng } from '../services/canvas-engine';
import { readRememberedCanvasId, useCanvasStore } from '../services/canvas-store';
import { canvasPngFilename, downloadPng } from '../services/png-export';
import { useToolStore } from '../services/tool-store';
import { buildViewUrl, readViewFromSearch, type AppView } from './view-route';

export function App() {
  const canvas = useCanvasStore((state) => state.canvas);
  const status = useCanvasStore((state) => state.status);
  const error = useCanvasStore((state) => state.error);
  const createNewCanvas = useCanvasStore((state) => state.createNewCanvas);
  const loadCanvas = useCanvasStore((state) => state.loadCanvas);
  const refreshCanvas = useCanvasStore((state) => state.refreshCanvas);
  const tool = useToolStore((state) => state.tool);
  const [exportError, setExportError] = useState<string | null>(null);
  const [view, setView] = useState<AppView>(() => readViewFromSearch(window.location.search));

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
    function handlePopState() {
      setView(readViewFromSearch(window.location.search));
    }

    window.addEventListener('popstate', handlePopState);

    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (view !== 'canvas') {
        return;
      }

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
  }, [view]);

  function navigate(next: AppView) {
    if (next === view) {
      return;
    }

    window.history.pushState(
      { page: next },
      '',
      buildViewUrl(window.location.href, next),
    );
    setView(next);
  }

  function handleExportPng() {
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
    } catch (caught) {
      setExportError(
        caught instanceof Error ? caught.message : 'Could not export PNG',
      );
    }
  }

  const menuMessage = error ?? exportError;

  return (
    <div className={view === 'monitor' ? 'app-shell app-shell--monitor' : 'app-shell'}>
      <header className="menu-bar">
        <span className="brand">PaintCodex</span>
        {view === 'canvas' && canvas ? (
          <span className="document-name">{canvas.name}</span>
        ) : null}
        <span className="menu-spacer" />
        {view === 'canvas' && menuMessage ? (
          <span className="menu-status">{menuMessage}</span>
        ) : null}
        {view === 'canvas' ? (
          <>
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
          </>
        ) : null}
        <button
          type="button"
          className="menu-button"
          onClick={() => navigate(view === 'monitor' ? 'canvas' : 'monitor')}
          aria-current={view === 'monitor' ? 'page' : undefined}
        >
          {view === 'monitor' ? 'Back to Canvas' : 'Monitor'}
        </button>
      </header>

      {/*
        The workspace stays mounted while monitoring so an in-flight AI chat
        and the canvas state survive the view switch.
      */}
      <div className={view === 'monitor' ? 'workspace app-hidden' : 'workspace'}>
        <Toolbox />
        <main className="canvas-area">
          <CanvasStage key={canvas?.id ?? 'blank'} />
        </main>
        <aside className="side-panel">
          <LayerPanel />
          <AiChatPanel />
        </aside>
      </div>

      {view === 'monitor' ? (
        <main className="monitor-area">
          <MonitorPage />
        </main>
      ) : null}

      {view === 'canvas' ? (
        <footer className="status-bar">
          <span>{canvas ? `${canvas.width} × ${canvas.height}` : 'No canvas'}</span>
          <span>Zoom: 100%</span>
          <span>{tool === 'brush' ? 'Brush' : 'Select'}</span>
        </footer>
      ) : null}
    </div>
  );
}

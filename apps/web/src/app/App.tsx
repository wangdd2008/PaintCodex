import { useEffect, useRef, useState } from 'react';
import { AiChatPanel } from '../features/ai-chat/AiChatPanel';
import { CanvasStage } from '../features/canvas/CanvasStage';
import { LayerPanel } from '../features/layer-panel/LayerPanel';
import { MonitorPage } from '../features/monitor/MonitorPage';
import {
  ConnectionStatus,
  type ConnectionState,
} from '../features/status-bar/ConnectionStatus';
import { SaveStatus } from '../features/status-bar/SaveStatus';
import { Toolbox } from '../features/toolbox/Toolbox';
import { subscribeToCanvas } from '../runtime/paint-sse';
import { exportActiveCanvasPng } from '../services/canvas-engine';
import { canvasJsonFilename, downloadCanvasJson } from '../services/json-export';
import { readRememberedCanvasId, useCanvasStore } from '../services/canvas-store';
import { canvasPngFilename, downloadPng } from '../services/png-export';
import { useToolStore } from '../services/tool-store';
import { useViewportStore } from '../services/viewport-store';
import { buildViewUrl, readViewFromSearch, type AppView } from './view-route';

export function App() {
  const canvas = useCanvasStore((state) => state.canvas);
  const status = useCanvasStore((state) => state.status);
  const error = useCanvasStore((state) => state.error);
  const createNewCanvas = useCanvasStore((state) => state.createNewCanvas);
  const loadCanvas = useCanvasStore((state) => state.loadCanvas);
  const refreshCanvas = useCanvasStore((state) => state.refreshCanvas);
  const tool = useToolStore((state) => state.tool);
  const zoomPercent = useViewportStore((state) => state.zoomPercent);
  const [exportError, setExportError] = useState<string | null>(null);
  const [view, setView] = useState<AppView>(() => readViewFromSearch(window.location.search));
  // 窄屏（≤860px）侧栏是覆盖式抽屉；桌面忽略这个状态，侧栏常驻。
  const [drawerOpen, setDrawerOpen] = useState(false);
  // SSE 连接状态只由 EventSource 的 open/error 驱动，不轮询、不手动重连。
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const drawerToggleRef = useRef<HTMLButtonElement | null>(null);

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

    // 打开（或切换到）一张画布时先显示「连接中…」，直到 SSE 的 open 事件到达。
    setConnectionState('connecting');

    return subscribeToCanvas(canvasId, {
      onOpen: () => {
        setConnectionState('live');
        void refreshCanvas();
      },
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
      onError: () => setConnectionState('reconnecting'),
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

  useEffect(() => {
    if (!drawerOpen) {
      return;
    }

    function handleDrawerKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') {
        return;
      }

      setDrawerOpen(false);
      // 抽屉由「图层」按钮打开，关闭后把焦点还回去。
      drawerToggleRef.current?.focus();
    }

    window.addEventListener('keydown', handleDrawerKeyDown);

    return () => window.removeEventListener('keydown', handleDrawerKeyDown);
  }, [drawerOpen]);

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
        throw new Error('画布尚未准备好导出');
      }

      downloadPng(dataUrl, canvasPngFilename(canvas.name));
      setExportError(null);
    } catch (caught) {
      setExportError(
        caught instanceof Error ? caught.message : '无法导出 PNG',
      );
    }
  }

  function handleExportJson() {
    if (!canvas) {
      return;
    }

    try {
      downloadCanvasJson(canvas, canvasJsonFilename(canvas.name));
      setExportError(null);
    } catch (caught) {
      setExportError(
        caught instanceof Error ? caught.message : '无法导出 JSON',
      );
    }
  }

  // Persistence is handling saving (ADR-0008); export only runs on demand.
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
              ref={drawerToggleRef}
              type="button"
              className="menu-button drawer-toggle"
              aria-expanded={drawerOpen}
              aria-controls="side-panel"
              onClick={() => setDrawerOpen((open) => !open)}
            >
              图层
            </button>
            {/* Without a canvas the empty state holds the only creation CTA. */}
            {canvas ? (
              <button
                type="button"
                className="menu-button"
                onClick={() => void createNewCanvas()}
                disabled={status === 'loading'}
              >
                {status === 'loading' ? '处理中…' : '新建画布'}
              </button>
            ) : null}
            <button
              type="button"
              className="menu-button"
              onClick={handleExportPng}
              disabled={!canvas}
            >
              导出 PNG
            </button>
            <button
              type="button"
              className="menu-button"
              onClick={handleExportJson}
              disabled={!canvas}
            >
              导出 JSON
            </button>
          </>
        ) : null}
        <button
          type="button"
          className="menu-button"
          onClick={() => navigate(view === 'monitor' ? 'canvas' : 'monitor')}
          aria-current={view === 'monitor' ? 'page' : undefined}
        >
          {view === 'monitor' ? '返回画布' : '监控'}
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
        <aside
          id="side-panel"
          className={drawerOpen ? 'side-panel side-panel--open' : 'side-panel'}
        >
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
          <span>{canvas ? `${canvas.width} × ${canvas.height}` : '无画布'}</span>
          <span>
            缩放 {zoomPercent === null ? '—' : `${zoomPercent.toFixed(1)}%`}
          </span>
          <span>{tool === 'brush' ? '画笔' : '选择'}</span>
          <SaveStatus />
          {/* 没有画布就没有 SSE 通道，不伪造连接状态。 */}
          {canvasId ? <ConnectionStatus state={connectionState} /> : null}
        </footer>
      ) : null}
    </div>
  );
}

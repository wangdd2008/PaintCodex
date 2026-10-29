import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { AiChatPanel } from '../features/ai-chat/AiChatPanel';
import { CanvasNameEditor } from '../features/canvas/CanvasNameEditor';
import { CanvasStage } from '../features/canvas/CanvasStage';
import { CanvasLibraryPage } from '../features/canvas-library/CanvasLibraryPage';
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
import {
  CHAT_WIDTH_DEFAULT,
  clampChatWidth,
  nextChatWidth,
  readChatWidth,
  writeChatWidth,
} from '../services/chat-width';
import { describeCanvasError, readRememberedCanvasId, useCanvasStore } from '../services/canvas-store';
import { displayCanvasName } from '../services/naming';
import { canvasPngFilename, downloadPng } from '../services/png-export';
import { useToolStore } from '../services/tool-store';
import { useViewportStore } from '../services/viewport-store';
import {
  buildCanvasUrl,
  buildViewUrl,
  readViewFromSearch,
  type AppView,
} from './view-route';

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

  // 对话列宽度（票 ②01）：记住的值，范围由 chat-width 模块 clamp。
  const [chatWidth, setChatWidth] = useState<number>(() => readChatWidth());
  // 对话列整体收起：列宽回 0，记住的宽度保留在 chatWidth 里。
  const [chatCollapsed, setChatCollapsed] = useState(false);
  // 图层列折叠：折成一条纵向把手，再点把手展开。
  const [layersCollapsed, setLayersCollapsed] = useState(false);
  // 拖动期间：禁文本选择、画布不收指针。
  const [resizing, setResizing] = useState(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(chatWidth);
  const dragMoved = useRef(false);

  useEffect(() => {
    // 直接深链进画布库时不自动加载后台画布：库不订阅 SSE（spec Out of Scope）。
    if (readViewFromSearch(window.location.search) === 'canvases') {
      return;
    }

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
    async function handlePopState() {
      const nextView = readViewFromSearch(window.location.search);
      setView(nextView);

      if (nextView !== 'canvas') {
        return;
      }

      const id = new URLSearchParams(window.location.search).get('canvasId');

      // 画布视图却没有 id（或 id 指向的文档已被删）：回库，不留在空白工作区。
      if (!id) {
        window.history.replaceState(
          {},
          '',
          buildViewUrl(window.location.href, 'canvases'),
        );
        setView('canvases');
        return;
      }

      if (id === useCanvasStore.getState().canvas?.id) {
        return;
      }

      await loadCanvas(id);

      if (useCanvasStore.getState().status === 'error') {
        window.history.replaceState(
          {},
          '',
          buildViewUrl(window.location.href, 'canvases'),
        );
        setView('canvases');
      }
    }

    window.addEventListener('popstate', handlePopState);

    return () => window.removeEventListener('popstate', handlePopState);
  }, [loadCanvas]);

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

  // 从库点卡片：历史上多一条画布记录，后退正好落回库（ADR-0010 §5）。
  function openFromLibrary(id: string) {
    window.history.pushState({}, '', buildCanvasUrl(window.location.href, id));
    setView('canvas');
    void loadCanvas(id);
  }

  // 从库新建：replaceState 把库那条历史换成新画布，不留「建之前的空页」。
  async function createFromLibrary() {
    await createNewCanvas();

    const id = useCanvasStore.getState().canvas?.id;

    if (id) {
      window.history.replaceState({}, '', buildCanvasUrl(window.location.href, id));
      setView('canvas');
    }
  }

  // 把宽度写到 documentElement 的 --chat-width：收起时列宽回 0，记住的值保留。
  useEffect(() => {
    document.documentElement.style.setProperty(
      '--chat-width',
      chatCollapsed ? '0px' : `${chatWidth}px`,
    );
  }, [chatWidth, chatCollapsed]);

  // 记住宽度：变化即持久化（读在 useState 初值里）。
  useEffect(() => {
    writeChatWidth(chatWidth);
  }, [chatWidth]);

  // 拖动结束时清理拖动态（pointerup 漏触发时兜底）。
  useEffect(() => {
    if (!resizing) {
      return;
    }

    function stop() {
      setResizing(false);
    }

    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);

    return () => {
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
  }, [resizing]);

  function handleResizerPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    dragStartX.current = event.clientX;
    dragStartWidth.current = chatCollapsed ? CHAT_WIDTH_DEFAULT : chatWidth;
    dragMoved.current = false;
    setResizing(true);

    // 拖动一开始就展开对话列：拖把手等于要调它的宽度。
    if (chatCollapsed) {
      setChatCollapsed(false);
    }
  }

  function handleResizerPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!resizing) {
      return;
    }

    const delta = event.clientX - dragStartX.current;

    if (Math.abs(delta) > 3) {
      dragMoved.current = true;
    }

    setChatWidth(clampChatWidth(dragStartWidth.current + delta));
  }

  function handleResizerPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    setResizing(false);
  }

  // 键盘：←/→ ±16，Home/End 到最小/最大。
  function handleResizerKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const next = nextChatWidth(chatWidth, event.key);

    if (next === chatWidth) {
      return;
    }

    event.preventDefault();
    setChatCollapsed(false);
    setChatWidth(next);
  }

  // 双击复位到默认 380px。
  function handleResizerDoubleClick() {
    setChatCollapsed(false);
    setChatWidth(CHAT_WIDTH_DEFAULT);
  }

  // 点把手（非拖动）时若对话列收起，则展开；拖过就不展开。
  function handleResizerClick() {
    if (dragMoved.current) {
      dragMoved.current = false;
      return;
    }

    if (chatCollapsed) {
      setChatCollapsed(false);
    }
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

      downloadPng(
        dataUrl,
        canvasPngFilename(displayCanvasName(canvas.name), canvas.id),
      );
      setExportError(null);
    } catch (caught) {
      setExportError(describeCanvasError(caught, '无法导出 PNG'));
    }
  }

  function handleExportJson() {
    if (!canvas) {
      return;
    }

    try {
      downloadCanvasJson(
        canvas,
        canvasJsonFilename(displayCanvasName(canvas.name), canvas.id),
      );
      setExportError(null);
    } catch (caught) {
      setExportError(describeCanvasError(caught, '无法导出 JSON'));
    }
  }

  // Persistence is handling saving (ADR-0008); export only runs on demand.
  const menuMessage = error ?? exportError;

  return (
    <div
      className={
        view === 'canvas' ? 'app-shell' : 'app-shell app-shell--monitor'
      }
    >
      <header className="menu-bar">
        <span className="brand">PaintCodex</span>
        {view === 'canvas' && canvas ? <CanvasNameEditor /> : null}
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
              <>
                {/* 画布库（?page=canvases）取代旧的「返回上一张」成为唯一的文档间导航；
                    新建是一次普通操作，成功后地址栏直接指向新画布（ADR-0010）。 */}
                <button
                  type="button"
                  className="menu-button"
                  onClick={() => void createNewCanvas()}
                  disabled={status === 'loading'}
                >
                  新建画布
                </button>
              </>
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
        {view !== 'canvases' ? (
          <button
            type="button"
            className="menu-button"
            onClick={() => navigate('canvases')}
          >
            画布库
          </button>
        ) : (
          <button
            type="button"
            className="menu-button"
            onClick={() => void createFromLibrary()}
          >
            新建画布
          </button>
        )}
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
      <div
        className={[
          view === 'canvas' ? 'workspace' : 'workspace app-hidden',
          resizing ? 'workspace--resizing' : '',
          layersCollapsed ? 'workspace--layers-collapsed' : '',
          chatCollapsed ? 'workspace--chat-collapsed' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <Toolbox />
        <main className="canvas-area">
          <CanvasStage key={canvas?.id ?? 'blank'} />
        </main>
        <aside
          id="side-panel"
          className={drawerOpen ? 'side-panel side-panel--open' : 'side-panel'}
        >
          <div
            className={
              layersCollapsed
                ? 'layer-column layer-column--collapsed'
                : 'layer-column'
            }
          >
            {layersCollapsed ? (
              <button
                type="button"
                className="layer-collapse-handle"
                aria-label="展开图层面板"
                onClick={() => setLayersCollapsed(false)}
              >
                <span className="layer-collapse-handle__label">图层</span>
              </button>
            ) : (
              <>
                <div className="column-header">
                  <button
                    type="button"
                    className="column-collapse-button"
                    aria-label="收起图层面板"
                    onClick={() => setLayersCollapsed(true)}
                  >
                    «
                  </button>
                </div>
                <LayerPanel />
              </>
            )}
            <div
              className="chat-resizer"
              role="separator"
              aria-orientation="vertical"
              aria-valuenow={chatWidth}
              aria-valuemin={320}
              aria-valuemax={640}
              aria-label="对话面板宽度"
              tabIndex={0}
              onPointerDown={handleResizerPointerDown}
              onPointerMove={handleResizerPointerMove}
              onPointerUp={handleResizerPointerUp}
              onKeyDown={handleResizerKeyDown}
              onDoubleClick={handleResizerDoubleClick}
              onClick={handleResizerClick}
            />
          </div>
          <div
            className={
              chatCollapsed ? 'chat-column chat-column--collapsed' : 'chat-column'
            }
          >
            {chatCollapsed ? (
              // 收起后必须留下可见的展开把手：对话列之前是一整块被隐藏的面板，
              // 唯一入口只有图层列右缘那条透明拖拽条，用户找不到就只能刷新页面，
              // 而刷新会清空会话记录（UX-24）。与图层列对齐同一套语义。
              <button
                type="button"
                className="chat-collapse-handle"
                aria-label="展开对话面板"
                onClick={() => setChatCollapsed(false)}
              >
                <span className="chat-collapse-handle__label">对话</span>
              </button>
            ) : (
              <>
                <div className="column-header">
                  <button
                    type="button"
                    className="column-collapse-button"
                    aria-label="收起对话面板"
                    onClick={() => setChatCollapsed(true)}
                  >
                    »
                  </button>
                </div>
                <AiChatPanel />
              </>
            )}
          </div>
        </aside>
      </div>

      {view === 'monitor' ? (
        <main className="monitor-area">
          <MonitorPage />
        </main>
      ) : null}

      {view === 'canvases' ? (
        <CanvasLibraryPage
          onOpenCanvas={openFromLibrary}
          onCreateCanvas={() => void createFromLibrary()}
        />
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

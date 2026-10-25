import { AiChatPanel } from '../features/ai-chat/AiChatPanel';
import { CanvasStage } from '../features/canvas/CanvasStage';
import { LayerPanel } from '../features/layer-panel/LayerPanel';
import { Toolbox } from '../features/toolbox/Toolbox';

export function App() {
  return (
    <div className="app-shell">
      <header className="menu-bar">
        <span className="brand">PaintCodex</span>
        <button type="button" className="menu-button">
          New Canvas
        </button>
        <button type="button" className="menu-button">
          Export PNG
        </button>
      </header>

      <div className="workspace">
        <Toolbox />
        <main className="canvas-area">
          <CanvasStage />
        </main>
        <aside className="side-panel">
          <LayerPanel />
          <AiChatPanel />
        </aside>
      </div>

      <footer className="status-bar">
        <span>1920 × 1080</span>
        <span>Zoom: 100%</span>
        <span>Brush</span>
      </footer>
    </div>
  );
}

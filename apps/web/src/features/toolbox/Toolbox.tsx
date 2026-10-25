import { useCanvasStore } from '../../services/canvas-store';
import { useToolStore } from '../../services/tool-store';
import './toolbox.css';

export function Toolbox() {
  const tool = useToolStore((state) => state.tool);
  const setTool = useToolStore((state) => state.setTool);
  const canUndo = useCanvasStore((state) => state.canvas?.history.canUndo ?? false);
  const canRedo = useCanvasStore((state) => state.canvas?.history.canRedo ?? false);
  const saving = useCanvasStore((state) => state.saving);
  const undo = useCanvasStore((state) => state.undo);
  const redo = useCanvasStore((state) => state.redo);

  return (
    <nav className="toolbox" aria-label="Tools">
      <button
        type="button"
        className={tool === 'brush' ? 'tool-button tool-button--active' : 'tool-button'}
        title="Brush"
        aria-pressed={tool === 'brush'}
        onClick={() => setTool('brush')}
      >
        Brush
      </button>
      <button
        type="button"
        className="tool-button"
        title="Undo (Ctrl+Z)"
        disabled={!canUndo || saving}
        onClick={() => void undo()}
      >
        Undo
      </button>
      <button
        type="button"
        className="tool-button"
        title="Redo (Ctrl+Y)"
        disabled={!canRedo || saving}
        onClick={() => void redo()}
      >
        Redo
      </button>
    </nav>
  );
}

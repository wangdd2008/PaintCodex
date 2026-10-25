import { useToolStore } from '../../services/tool-store';
import './toolbox.css';

export function Toolbox() {
  const tool = useToolStore((state) => state.tool);
  const setTool = useToolStore((state) => state.setTool);

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
      <button type="button" className="tool-button" title="Undo" disabled>
        Undo
      </button>
      <button type="button" className="tool-button" title="Redo" disabled>
        Redo
      </button>
    </nav>
  );
}

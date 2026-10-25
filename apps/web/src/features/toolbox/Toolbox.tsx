import './toolbox.css';

export function Toolbox() {
  return (
    <nav className="toolbox" aria-label="Tools">
      <button type="button" className="tool-button tool-button--active" title="Brush">
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

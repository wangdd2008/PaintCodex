import { useCanvasStore } from '../../services/canvas-store';
import './layer-panel.css';

export function LayerPanel() {
  const canvas = useCanvasStore((state) => state.canvas);

  return (
    <section className="layer-panel" aria-label="Layers">
      <h2 className="panel-title">Layers</h2>

      {!canvas ? (
        <p className="panel-empty">No canvas loaded yet.</p>
      ) : canvas.layers.length === 0 ? (
        <p className="panel-empty">No layers yet.</p>
      ) : (
        <ul className="layer-list">
          {canvas.layers.map((layer) => (
            <li key={layer.id} className="layer-item">
              <span className="layer-item__visibility" aria-hidden="true">
                {layer.visible ? '●' : '○'}
              </span>
              <span className="layer-item__name">{layer.name}</span>
              <span className="layer-item__type">{layer.type}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

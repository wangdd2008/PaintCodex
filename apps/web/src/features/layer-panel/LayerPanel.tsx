import type { Layer } from '@paintcodex/protocol';
import { useCanvasStore } from '../../services/canvas-store';
import './layer-panel.css';

export function LayerPanel() {
  const canvas = useCanvasStore((state) => state.canvas);
  const activeLayerId = useCanvasStore((state) => state.activeLayerId);
  const saving = useCanvasStore((state) => state.saving);
  const setActiveLayer = useCanvasStore((state) => state.setActiveLayer);
  const updateLayer = useCanvasStore((state) => state.updateLayer);
  const deleteLayer = useCanvasStore((state) => state.deleteLayer);

  function handleDelete(layer: Layer) {
    if (window.confirm(`Delete layer "${layer.name}"?`)) {
      void deleteLayer(layer.id).catch(() => undefined);
    }
  }

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
            <li
              key={layer.id}
              className={
                layer.id === activeLayerId ? 'layer-item layer-item--active' : 'layer-item'
              }
              onClick={() => setActiveLayer(layer.id)}
            >
              <button
                type="button"
                className="layer-item__visibility"
                aria-label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
                aria-pressed={layer.visible}
                onClick={(event) => {
                  event.stopPropagation();
                  void updateLayer(layer.id, { visible: !layer.visible }).catch(
                    () => undefined,
                  );
                }}
              >
                {layer.visible ? '●' : '○'}
              </button>
              <span className="layer-item__name">{layer.name}</span>
              <span className="layer-item__type">{layer.type}</span>
              <button
                type="button"
                className="layer-item__delete"
                aria-label={`Delete ${layer.name}`}
                disabled={saving}
                onClick={(event) => {
                  event.stopPropagation();
                  handleDelete(layer);
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

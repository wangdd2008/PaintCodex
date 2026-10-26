import { useCanvasStore } from '../../services/canvas-store';
import {
  BRUSH_COLOR_PRESETS,
  BRUSH_WIDTHS,
  useToolStore,
} from '../../services/tool-store';
import './toolbox.css';

export function Toolbox() {
  const tool = useToolStore((state) => state.tool);
  const setTool = useToolStore((state) => state.setTool);
  const brushColor = useToolStore((state) => state.brushColor);
  const brushWidth = useToolStore((state) => state.brushWidth);
  const setBrushColor = useToolStore((state) => state.setBrushColor);
  const setBrushWidth = useToolStore((state) => state.setBrushWidth);
  const canvas = useCanvasStore((state) => state.canvas);
  const canUndo = useCanvasStore((state) => state.canvas?.history.canUndo ?? false);
  const canRedo = useCanvasStore((state) => state.canvas?.history.canRedo ?? false);
  const saving = useCanvasStore((state) => state.saving);
  const undo = useCanvasStore((state) => state.undo);
  const redo = useCanvasStore((state) => state.redo);
  const customColorSelected = !BRUSH_COLOR_PRESETS.some(
    (preset) => preset.value === brushColor,
  );

  return (
    <nav className="toolbox" aria-label="工具">
      <button
        type="button"
        className={tool === 'brush' ? 'tool-button tool-button--active' : 'tool-button'}
        title="画笔"
        aria-pressed={tool === 'brush'}
        disabled={!canvas}
        onClick={() => setTool('brush')}
      >
        画笔
      </button>
      <button
        type="button"
        className={tool === 'select' ? 'tool-button tool-button--active' : 'tool-button'}
        title="选择和移动 AI 图层"
        aria-pressed={tool === 'select'}
        disabled={!canvas}
        onClick={() => setTool('select')}
      >
        选择
      </button>
      <button
        type="button"
        className="tool-button"
        title="撤销 (Ctrl+Z)"
        disabled={!canUndo || saving}
        onClick={() => void undo()}
      >
        撤销
      </button>
      <button
        type="button"
        className="tool-button"
        title="重做 (Ctrl+Y)"
        disabled={!canRedo || saving}
        onClick={() => void redo()}
      >
        重做
      </button>

      <div className="toolbox-group toolbox-group--palette" role="group" aria-label="画笔颜色">
        {BRUSH_COLOR_PRESETS.map((preset) => {
          const selected = preset.value === brushColor;

          return (
            <button
              key={preset.value}
              type="button"
              className={
                selected ? 'toolbox-swatch toolbox-swatch--selected' : 'toolbox-swatch'
              }
              style={{ backgroundColor: preset.value }}
              title={preset.label}
              aria-label={preset.label}
              aria-pressed={selected}
              onClick={() => setBrushColor(preset.value)}
            >
              {selected ? (
                <span className="toolbox-check" aria-hidden="true">
                  ✓
                </span>
              ) : null}
            </button>
          );
        })}
        <label
          className={
            customColorSelected
              ? 'toolbox-custom toolbox-custom--selected'
              : 'toolbox-custom'
          }
          title="自定义颜色"
        >
          <input
            type="color"
            className="toolbox-custom__input"
            aria-label="自定义画笔颜色"
            value={brushColor}
            onChange={(event) => setBrushColor(event.target.value)}
          />
          {customColorSelected ? (
            <span className="toolbox-check" aria-hidden="true">
              ✓
            </span>
          ) : null}
        </label>
      </div>

      <div className="toolbox-group toolbox-group--widths" role="group" aria-label="画笔粗细">
        {BRUSH_WIDTHS.map((width) => {
          const selected = width === brushWidth;

          return (
            <button
              key={width}
              type="button"
              className={
                selected ? 'toolbox-width toolbox-width--selected' : 'toolbox-width'
              }
              title={`笔宽 ${width}`}
              aria-label={`笔宽 ${width}`}
              aria-pressed={selected}
              onClick={() => setBrushWidth(width)}
            >
              <span
                className="toolbox-width__stroke"
                style={{ height: `${width}px`, backgroundColor: brushColor }}
                aria-hidden="true"
              />
              {selected ? (
                <span className="toolbox-width__check" aria-hidden="true">
                  ✓
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

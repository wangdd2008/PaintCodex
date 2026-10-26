import type { Layer } from '@paintcodex/protocol';
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { useCanvasStore } from '../../services/canvas-store';
import './layer-panel.css';

/** 读屏用的类型名：界面上的类型文字另有呈现，这里只为播报服务。 */
const LAYER_TYPE_LABELS: Record<Layer['type'], string> = {
  raster: '位图',
  vector: '笔迹',
  'ai-generated': 'AI 生成',
};

/**
 * 一行图层的完整读屏名称。选中态不写进名称：`aria-selected` 已经承担，
 * 重复播报反而让状态听起来像名字的一部分。
 */
function describeLayer(layer: Layer): string {
  return `${layer.name}，${LAYER_TYPE_LABELS[layer.type]}，${layer.visible ? '可见' : '已隐藏'}`;
}

/** 眼睛 / 眼睛加斜线：状态不只靠颜色，隐藏态的形状也不同。 */
function VisibilityIcon({ visible }: { visible: boolean }) {
  return (
    <svg
      className="layer-item__icon"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-icon={visible ? 'eye' : 'eye-off'}
    >
      <path d="M1.2 8S3.6 3.8 8 3.8 14.8 8 14.8 8 12.4 12.2 8 12.2 1.2 8 1.2 8Z" />
      <circle cx="8" cy="8" r="2.1" />
      {visible ? null : <path d="M2.4 2.4l11.2 11.2" />}
    </svg>
  );
}

export function LayerPanel() {
  const canvas = useCanvasStore((state) => state.canvas);
  const activeLayerId = useCanvasStore((state) => state.activeLayerId);
  const saving = useCanvasStore((state) => state.saving);
  const setActiveLayer = useCanvasStore((state) => state.setActiveLayer);
  const updateLayer = useCanvasStore((state) => state.updateLayer);
  const deleteLayer = useCanvasStore((state) => state.deleteLayer);

  const listRef = useRef<HTMLUListElement>(null);
  const knownLayerIds = useRef<Set<string>>(new Set());
  const shownCanvasId = useRef<string | null>(null);
  /**
   * Roving tabindex: Tab enters the list once (at the last focused or selected
   * row), arrows move within it. Without this every row would be a tab stop and
   * keyboard users would have to tab through dozens of layers to leave.
   */
  const [focusedLayerId, setFocusedLayerId] = useState<string | null>(null);

  const layers = canvas?.layers ?? [];
  const focusedStillExists =
    focusedLayerId !== null && layers.some((layer) => layer.id === focusedLayerId);
  const rovingLayerId = focusedStillExists
    ? focusedLayerId
    : activeLayerId !== null && layers.some((layer) => layer.id === activeLayerId)
      ? activeLayerId
      : (layers[0]?.id ?? null);

  // Selection can change from outside the panel (new stroke, undo, AI layer).
  // Keep the tab stop on the selected row unless the user is already roaming.
  useEffect(() => {
    if (activeLayerId !== null) {
      setFocusedLayerId(activeLayerId);
    }
  }, [activeLayerId]);

  // A newly created layer may land outside the capped list; bring it into view
  // without scrolling the whole sidebar. Switching canvases is not an add.
  useEffect(() => {
    const nextLayers = canvas?.layers ?? [];

    if (canvas?.id !== shownCanvasId.current) {
      shownCanvasId.current = canvas?.id ?? null;
      knownLayerIds.current = new Set(nextLayers.map((layer) => layer.id));
      return;
    }

    const added = nextLayers.filter((layer) => !knownLayerIds.current.has(layer.id));
    knownLayerIds.current = new Set(nextLayers.map((layer) => layer.id));

    const newest = added.at(-1);

    if (!newest) {
      return;
    }

    const item = Array.from(listRef.current?.children ?? []).find(
      (child) => child.getAttribute('data-layer-id') === newest.id,
    );

    item?.scrollIntoView({ block: 'nearest' });
  }, [canvas]);

  function activateLayer(layer: Layer) {
    setFocusedLayerId(layer.id);
    setActiveLayer(layer.id);
  }

  function focusRow(layerId: string) {
    const rows = Array.from(listRef.current?.children ?? []);
    const target = rows.find((row) => row.getAttribute('data-layer-id') === layerId);

    if (target instanceof HTMLElement) {
      target.focus();
      setFocusedLayerId(layerId);
    }
  }

  function handleDelete(layer: Layer) {
    // The delete button is disabled while a mutation is in flight; the Delete
    // shortcut must not queue a second delete behind it.
    if (saving) {
      return;
    }

    if (window.confirm(`删除图层 "${layer.name}"?`)) {
      void deleteLayer(layer.id).catch(() => undefined);
    }
  }

  /**
   * Only the row itself handles keys: `Enter`/`Space` on the visibility or
   * delete button must keep operating that button, not select the row.
   */
  function handleRowKeyDown(
    event: ReactKeyboardEvent<HTMLLIElement>,
    layer: Layer,
    index: number,
  ) {
    if (event.target !== event.currentTarget) {
      return;
    }

    const lastIndex = layers.length - 1;

    switch (event.key) {
      case 'ArrowDown': {
        event.preventDefault();
        const next = layers[index + 1] ?? layers[lastIndex];

        if (next) {
          focusRow(next.id);
        }

        return;
      }

      case 'ArrowUp': {
        event.preventDefault();
        const previous = layers[index - 1] ?? layers[0];

        if (previous) {
          focusRow(previous.id);
        }

        return;
      }

      case 'Home': {
        event.preventDefault();
        const first = layers[0];

        if (first) {
          focusRow(first.id);
        }

        return;
      }

      case 'End': {
        event.preventDefault();
        const last = layers[lastIndex];

        if (last) {
          focusRow(last.id);
        }

        return;
      }

      case 'Enter':
      case ' ':
      case 'Spacebar': {
        event.preventDefault();
        activateLayer(layer);
        return;
      }

      case 'Delete': {
        event.preventDefault();
        handleDelete(layer);
        return;
      }

      default:
        return;
    }
  }

  return (
    <section className="layer-panel" aria-label="图层">
      <h2 className="panel-title">图层</h2>

      {!canvas ? (
        <p className="panel-empty">还没有画布</p>
      ) : layers.length === 0 ? (
        <p className="panel-empty">暂无图层。</p>
      ) : (
        <ul
          className="layer-list"
          ref={listRef}
          role="listbox"
          aria-label="图层列表"
          aria-orientation="vertical"
        >
          {layers.map((layer, index) => {
            const active = layer.id === activeLayerId;

            return (
              <li
                key={layer.id}
                data-layer-id={layer.id}
                role="option"
                aria-selected={active}
                aria-label={describeLayer(layer)}
                tabIndex={layer.id === rovingLayerId ? 0 : -1}
                className={active ? 'layer-item layer-item--active' : 'layer-item'}
                onClick={() => activateLayer(layer)}
                onFocus={() => setFocusedLayerId(layer.id)}
                onKeyDown={(event) => handleRowKeyDown(event, layer, index)}
              >
                <button
                  type="button"
                  className="layer-item__visibility"
                  aria-label={`${layer.name} 可见性`}
                  aria-pressed={layer.visible}
                  onClick={(event) => {
                    event.stopPropagation();
                    void updateLayer(layer.id, { visible: !layer.visible }).catch(
                      () => undefined,
                    );
                  }}
                >
                  <VisibilityIcon visible={layer.visible} />
                </button>
                <span className="layer-item__tooltip" aria-hidden="true">
                  {layer.visible ? '隐藏图层' : '显示图层'}
                </span>
                <span className="layer-item__name">{layer.name}</span>
                <span
                  className={
                    layer.type === 'ai-generated'
                      ? 'layer-item__type layer-item__type--ai'
                      : 'layer-item__type'
                  }
                >
                  {layer.type === 'ai-generated' ? '✦ AI' : layer.type}
                </span>
                <button
                  type="button"
                  className="layer-item__delete"
                  aria-label={`删除 ${layer.name}`}
                  disabled={saving}
                  onClick={(event) => {
                    event.stopPropagation();
                    handleDelete(layer);
                  }}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

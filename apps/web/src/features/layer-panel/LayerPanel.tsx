import type { Layer } from '@paintcodex/protocol';
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { useCanvasStore } from '../../services/canvas-store';
import './layer-panel.css';

/** 删除后的恢复条存活 8 秒；连续删除时后一条替换前一条并重新计时。 */
export const DELETE_RESTORE_TIMEOUT_MS = 8000;

/** 图层类型的唯一中文说法：列表徽标与读屏名称共用，避免两处漂移。 */
const LAYER_TYPE_LABELS: Record<Layer['type'], string> = {
  raster: '图片',
  vector: '笔迹',
  'ai-generated': 'AI',
};

interface DeleteRestore {
  layerId: string;
  name: string;
  /**
   * 删除请求返回的 revision。撤销仍是快照级（ADR-0003），只有当前 revision
   * 仍等于它时撤销才安全；任何后续操作都会让它降级成纯文本。
   */
  revision: number;
}

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
  const setActiveLayer = useCanvasStore((state) => state.setActiveLayer);
  const updateLayer = useCanvasStore((state) => state.updateLayer);
  const deleteLayer = useCanvasStore((state) => state.deleteLayer);
  const undo = useCanvasStore((state) => state.undo);

  const listRef = useRef<HTMLUListElement>(null);
  const knownLayerIds = useRef<Set<string>>(new Set());
  const shownCanvasId = useRef<string | null>(null);
  /**
   * Roving tabindex: Tab enters the list once (at the last focused or selected
   * row), arrows move within it. Without this every row would be a tab stop and
   * keyboard users would have to tab through dozens of layers to leave.
   */
  const [focusedLayerId, setFocusedLayerId] = useState<string | null>(null);
  /** One restore bar only: a newer delete replaces the older one. */
  const [restore, setRestore] = useState<DeleteRestore | null>(null);
  const [deletingLayerId, setDeletingLayerId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const restoreTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const layers = canvas?.layers ?? [];
  const canvasId = canvas?.id ?? null;
  const restoreStale =
    restore !== null &&
    (canvas === null || canvas.revision !== restore.revision);

  function clearRestoreTimer() {
    if (restoreTimer.current !== null) {
      clearTimeout(restoreTimer.current);
      restoreTimer.current = null;
    }
  }

  // 换画布就作废：撤销会作用到当前画布，上一张画布的删除无法这样恢复。
  useEffect(() => {
    clearRestoreTimer();
    setRestore(null);
  }, [canvasId]);

  useEffect(() => clearRestoreTimer, []);

  // 工具栏撤销（Ctrl+Z）也会把图层放回来；图层回来即说明恢复条已无意义。
  useEffect(() => {
    if (!restore) {
      return;
    }

    if (!canvas?.layers.some((layer) => layer.id === restore.layerId)) {
      return;
    }

    clearRestoreTimer();
    setRestore(null);
  }, [canvas, restore]);

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

  async function handleDelete(layer: Layer) {
    // One delete at a time: the row buttons are disabled while it is in flight,
    // and the Delete shortcut must not queue a second one behind it.
    if (deletingLayerId !== null) {
      return;
    }

    setDeletingLayerId(layer.id);

    let deletedRevision: number | null = null;

    try {
      const updated = await deleteLayer(layer.id);
      deletedRevision = updated.revision;
    } catch {
      // 失败原因与重试由画布顶部横幅承载（票 02）。重试仍走本组件的删除流程，
      // 这样重试成功后同样会出现恢复条，而不是「删掉了但没有撤销入口」。
      const state = useCanvasStore.getState();
      state.showCanvasAlert(
        state.canvasAlert ?? `无法删除图层：${state.saveError ?? '未知原因'}`,
        () => handleDelete(layer),
      );
      return;
    } finally {
      setDeletingLayerId(null);
    }

    if (deletedRevision === null) {
      return;
    }

    const state = useCanvasStore.getState();

    // 上一次删除失败的横幅已经不再成立；成功一次就撤掉，避免「删掉了还挂着报错」。
    if (state.canvasAlert?.startsWith('无法删除图层：')) {
      state.dismissCanvasAlert();
    }

    clearRestoreTimer();
    setRestore({ layerId: layer.id, name: layer.name, revision: deletedRevision });
    restoreTimer.current = setTimeout(() => {
      restoreTimer.current = null;
      setRestore(null);
    }, DELETE_RESTORE_TIMEOUT_MS);
  }

  async function handleRestore() {
    if (restoring || !restore || !canvas || canvas.revision !== restore.revision) {
      return;
    }

    setRestoring(true);

    try {
      // 快照级撤销（ADR-0003）：名称、可见性、内容与像素都由服务端快照恢复。
      await undo();
    } finally {
      setRestoring(false);
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
        void handleDelete(layer);
        return;
      }

      default:
        return;
    }
  }

  return (
    <section className="layer-panel" aria-label="图层">
      <h2 className="panel-title">图层</h2>

      {restore ? (
        <div className="layer-restore" role="status">
          <p className="layer-restore__message">
            已删除「{restore.name}」
            {restoreStale ? '· 已有后续操作' : null}
          </p>
          {restoreStale ? null : (
            <>
              <span className="layer-restore__separator" aria-hidden="true">
                ·{' '}
              </span>
              <button
                type="button"
                className="layer-restore__undo"
                disabled={restoring}
                onClick={() => void handleRestore()}
              >
                撤销
              </button>
            </>
          )}
        </div>
      ) : null}

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
                  {LAYER_TYPE_LABELS[layer.type]}
                </span>
                <button
                  type="button"
                  className="layer-item__delete"
                  aria-label={`删除 ${layer.name}`}
                  disabled={deletingLayerId !== null}
                  onClick={(event) => {
                    event.stopPropagation();
                    void handleDelete(layer);
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

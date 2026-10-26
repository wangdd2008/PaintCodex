import type { Layer } from '@paintcodex/protocol';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useCanvasStore } from '../../services/canvas-store';
import { previewLayerOpacity } from '../../services/layer-preview';

/** 0–100% 按 5% 一档：够细，又不会让一次拖动掉进十几个撤销步。 */
export const OPACITY_STEP = 5;

/** 浮层宽度：够放下 21 档滑块、标签与百分比数字。 */
const POPOVER_WIDTH = 208;
const POPOVER_GAP = 6;
const VIEWPORT_MARGIN = 8;

function toPercent(opacity: number): number {
  return Math.min(100, Math.max(0, Math.round(opacity * 100)));
}

interface LayerOpacityControlProps {
  layer: Layer;
}

/**
 * 行尾的不透明度控件：按钮常显当前百分比，点开是 0–100% 滑块（audit L-04 的
 * 「折叠在行尾的小浮层」形态——300px 侧栏里放不下一整条常驻滑块而不压扁名称）。
 *
 * 拖动只走本地预览（`input` → Fabric 对象），松手（原生 `change`）才发一次
 * PATCH，因此一次拖动 = 一个撤销步（ADR-0003）。浮层用 portal + fixed 定位：
 * 图层列表是独立滚动容器（票 06），行内绝对定位会被裁切。
 */
export function LayerOpacityControl({ layer }: LayerOpacityControlProps) {
  const updateLayer = useCanvasStore((state) => state.updateLayer);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => toPercent(layer.opacity));
  const [position, setPosition] = useState<{ top: number; left: number } | null>(
    null,
  );
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const sliderRef = useRef<HTMLInputElement>(null);
  const panelId = useId();
  const percent = toPercent(layer.opacity);

  // 快照（撤销、别的标签页、提交成功）是滑块的默认值；浮层打开时不覆盖手感。
  useEffect(() => {
    if (!open) {
      setDraft(percent);
    }
  }, [open, percent]);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }

    const trigger = triggerRef.current;

    if (!trigger) {
      return;
    }

    const rect = trigger.getBoundingClientRect();
    const left = Math.max(
      VIEWPORT_MARGIN,
      Math.min(
        rect.right - POPOVER_WIDTH,
        window.innerWidth - POPOVER_WIDTH - VIEWPORT_MARGIN,
      ),
    );

    setPosition({ top: rect.bottom + POPOVER_GAP, left });
  }, [open]);

  // 浮层渲染出来后再聚焦滑块：键盘用户打开即可用方向键调。
  useEffect(() => {
    if (position) {
      sliderRef.current?.focus();
    }
  }, [position]);

  async function commitOpacity(nextPercent: number) {
    if (nextPercent === percent) {
      return;
    }

    try {
      await updateLayer(layer.id, { opacity: nextPercent / 100 });
    } catch {
      // 失败回滚：预览与滑块都回到快照里的旧值；原因与重试由画布顶部横幅承载。
      previewLayerOpacity(layer.id, layer.opacity);
      setDraft(percent);
    }
  }

  // 事件回调里永远读到最新一次渲染的提交函数。
  const commitRef = useRef(commitOpacity);
  useEffect(() => {
    commitRef.current = commitOpacity;
  });

  /**
   * React 的 `onChange` 对 range 来说就是原生 `input`（拖动中的每一帧），
   * 所以「松手才提交」只能听原生 `change`。
   */
  useEffect(() => {
    const slider = sliderRef.current;

    if (!open || !slider) {
      return;
    }

    function handleNativeChange() {
      const current = sliderRef.current;

      if (current) {
        void commitRef.current(Number(current.value));
      }
    }

    slider.addEventListener('change', handleNativeChange);

    return () => slider.removeEventListener('change', handleNativeChange);
  }, [open, position]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleOutsidePointer(event: MouseEvent) {
      const target = event.target as Node | null;

      if (
        popoverRef.current?.contains(target) ||
        triggerRef.current?.contains(target)
      ) {
        return;
      }

      setOpen(false);
    }

    function handleViewportChange() {
      // 滚动或缩放后浮层会脱离锚点；直接收起，比错位更诚实。
      setOpen(false);
    }

    document.addEventListener('mousedown', handleOutsidePointer);
    window.addEventListener('scroll', handleViewportChange, true);
    window.addEventListener('resize', handleViewportChange);

    return () => {
      document.removeEventListener('mousedown', handleOutsidePointer);
      window.removeEventListener('scroll', handleViewportChange, true);
      window.removeEventListener('resize', handleViewportChange);
    };
  }, [open]);

  function closePopover(returnFocus: boolean) {
    setOpen(false);

    if (returnFocus) {
      triggerRef.current?.focus();
    }
  }

  function handleSliderInput(event: FormEvent<HTMLInputElement>) {
    const next = Number(event.currentTarget.value);

    if (Number.isNaN(next)) {
      return;
    }

    setDraft(next);
    // 拖动过程只改本地 Fabric 对象：不发 PATCH，一次拖动只留一个撤销步。
    previewLayerOpacity(layer.id, next / 100);
  }

  function handlePopoverKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Escape') {
      return;
    }

    // Esc 只关浮层，不冒泡去关窄屏抽屉（票 14），也不触发行级导航。
    event.preventDefault();
    event.stopPropagation();
    closePopover(true);
  }

  /** Tab 离开浮层即收起：不留下一个看不见却还开着的浮层。 */
  function handlePopoverBlur(event: ReactFocusEvent<HTMLDivElement>) {
    const next = event.relatedTarget as Node | null;

    if (
      next &&
      (popoverRef.current?.contains(next) || triggerRef.current?.contains(next))
    ) {
      return;
    }

    setOpen(false);
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="layer-item__opacity"
        aria-label={`不透明度 ${percent}%`}
        aria-expanded={open}
        aria-controls={open ? `${panelId}-popover` : undefined}
        title="图层不透明度"
        onClick={(event) => {
          event.stopPropagation();
          setOpen((current) => !current);
        }}
      >
        {percent}%
      </button>
      {open && position
        ? createPortal(
            <div
              ref={popoverRef}
              id={`${panelId}-popover`}
              className="layer-opacity"
              role="group"
              aria-label={`「${layer.name}」不透明度`}
              style={{
                top: position.top,
                left: position.left,
                width: POPOVER_WIDTH,
              }}
              onClick={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
              onKeyDown={handlePopoverKeyDown}
              onBlur={handlePopoverBlur}
            >
              <label className="layer-opacity__label" htmlFor={`${panelId}-slider`}>
                不透明度
              </label>
              <output className="layer-opacity__value" htmlFor={`${panelId}-slider`}>
                {draft}%
              </output>
              <input
                ref={sliderRef}
                id={`${panelId}-slider`}
                className="layer-opacity__slider"
                type="range"
                min={0}
                max={100}
                step={OPACITY_STEP}
                value={draft}
                aria-valuetext={`${draft}%`}
                onInput={handleSliderInput}
                onClick={(event) => event.stopPropagation()}
              />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

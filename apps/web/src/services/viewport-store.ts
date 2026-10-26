import { create } from 'zustand';

/**
 * 文档固定为 1920 × 1080，但 CSS 会按可用宽度缩放。状态栏必须报告真实比例，
 * 所以缩放率由渲染后的画布宽度推导，而不是写死。
 */
export function computeZoomPercent(
  renderedWidth: number,
  canvasWidth: number,
): number {
  if (
    !Number.isFinite(renderedWidth) ||
    !Number.isFinite(canvasWidth) ||
    renderedWidth <= 0 ||
    canvasWidth <= 0
  ) {
    return 0;
  }

  return Math.round((renderedWidth / canvasWidth) * 1000) / 10;
}

interface ViewportState {
  /** 渲染宽度 / 文档宽度，以保留一位小数的百分比表示。 */
  zoomPercent: number | null;
  setZoomPercent: (zoomPercent: number | null) => void;
}

export const useViewportStore = create<ViewportState>((set) => ({
  zoomPercent: null,
  setZoomPercent: (zoomPercent: number | null) => set({ zoomPercent }),
}));

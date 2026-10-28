import { create } from 'zustand';

/**
 * 状态栏缩放百分比。ADR-0011：缩放交给 Fabric 的 viewportTransform，百分比直接
 * 来自当前 scale，不再从渲染宽度反推。输入就是当前缩放比（1 = 100%）。
 */
export function computeZoomPercent(scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) {
    return 0;
  }

  return Math.round(scale * 1000) / 10;
}

interface ViewportState {
  /** 当前缩放百分比（保留一位小数）；null 表示还没拿到 scale。 */
  zoomPercent: number | null;
  setZoomPercent: (zoomPercent: number | null) => void;
}

export const useViewportStore = create<ViewportState>((set) => ({
  zoomPercent: null,
  setZoomPercent: (zoomPercent) => set({ zoomPercent }),
}));

import { create } from 'zustand';

/**
 * The document is always 1920 × 1080, but CSS scales it to the available
 * width. The status bar must report that real ratio, so zoom is derived from
 * the rendered canvas width rather than hard-coded.
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
  /** Rendered width / document width, as a percentage with one decimal. */
  zoomPercent: number | null;
  setZoomPercent: (zoomPercent: number | null) => void;
}

export const useViewportStore = create<ViewportState>((set) => ({
  zoomPercent: null,
  setZoomPercent: (zoomPercent: number | null) => set({ zoomPercent }),
}));

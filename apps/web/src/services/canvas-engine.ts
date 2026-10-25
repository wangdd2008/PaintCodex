import type { Canvas } from 'fabric';

let activeCanvas: Canvas | null = null;

/** Registers the Fabric canvas that the Export PNG action should capture. */
export function setActiveCanvas(canvas: Canvas | null): void {
  activeCanvas = canvas;
}

/** Renders the registered canvas to a PNG data URL, or null when none exists. */
export function exportActiveCanvasPng(): string | null {
  if (!activeCanvas) {
    return null;
  }

  return activeCanvas.toDataURL({ format: 'png', multiplier: 1 });
}

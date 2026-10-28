import type { Canvas } from 'fabric';
import { docToScreen } from './viewport-math';

let activeCanvas: Canvas | null = null;
/** 当前文档尺寸：导出按文档原生分辨率渲染，而不是视口/屏幕尺寸（ADR-0011）。 */
let activeDocSize: { width: number; height: number } | null = null;

/** Registers the Fabric canvas that the Export PNG action should capture. */
export function setActiveCanvas(
  canvas: Canvas | null,
  docSize?: { width: number; height: number },
): void {
  activeCanvas = canvas;
  activeDocSize = canvas ? docSize ?? null : null;
}

/**
 * Renders the registered canvas to a PNG data URL at document resolution.
 * 画布 backing 现在是视口像素、内容经过 viewportTransform；导出要裁出文档矩形
 * 并按 1/scale 采样，输出才是文档原生尺寸，而不是当前屏幕尺寸。
 */
export function exportActiveCanvasPng(): string | null {
  if (!activeCanvas || !activeDocSize) {
    return null;
  }

  const vpt = activeCanvas.viewportTransform;
  const scale = vpt[0];

  if (!(scale > 0)) {
    return activeCanvas.toDataURL({ format: 'png', multiplier: 1 });
  }

  const origin = docToScreen(0, 0, vpt);

  return activeCanvas.toDataURL({
    format: 'png',
    left: origin.x,
    top: origin.y,
    width: activeDocSize.width * scale,
    height: activeDocSize.height * scale,
    multiplier: 1 / scale,
  });
}

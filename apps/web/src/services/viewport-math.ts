/**
 * 画布视口（缩放/平移）的纯函数。ADR-0011：缩放交给 Fabric 的
 * viewportTransform，文档坐标是唯一坐标。这里只算数学，不碰 Fabric 实例，
 * 以便在 jsdom 里单测，也让 ②05 的叠加层换算复用同一个 docToScreen。
 *
 * viewportTransform 是 Fabric 的 2D 矩阵 [a, b, c, d, e, f]：
 *   screenX = a * docX + e
 *   screenY = d * docY + f
 * 本项目只做等比缩放与平移，所以 b/c = 0、a = d = scale。
 */

/** 允许的最小缩放（文档视图缩到能看全为止）。 */
export const MIN_SCALE = 0.05;
/** 允许的最大缩放（细节放大上限）。 */
export const MAX_SCALE = 8;

/** Fabric 的 TMat2D：[a, b, c, d, e, f]。 */
export type ViewportTransform = [
  a: number,
  b: number,
  c: number,
  d: number,
  e: number,
  f: number,
];

function usable(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/**
 * 适应窗口的等比缩放：取宽/高两个比值的较小者，让文档完整放进容器。
 * 容器测不到尺寸（jsdom / 未布局）时回退 1，避免 0 缩放把文档缩没。
 */
export function fitScale(
  containerW: number,
  containerH: number,
  docW: number,
  docH: number,
): number {
  if (!usable(docW) || !usable(docH)) {
    return 1;
  }

  if (!usable(containerW) || !usable(containerH)) {
    return 1;
  }

  return Math.min(containerW / docW, containerH / docH);
}

/** 把缩放限制在 [MIN_SCALE, MAX_SCALE]。 */
export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) {
    return MIN_SCALE;
  }

  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * 文档坐标 → 屏幕像素。叠加层（AI 高亮、选中定位）用它把文档里的点
 * 换算成视口里的绝对像素：`x * a + e`、`y * d + f`。
 */
export function docToScreen(
  docX: number,
  docY: number,
  vpt: readonly [number, number, number, number, number, number],
): { x: number; y: number } {
  return {
    x: docX * vpt[0] + vpt[4],
    y: docY * vpt[3] + vpt[5],
  };
}

/**
 * 构造「适应窗口」的视口变换矩阵：内容等比缩放后居中放进容器。
 * 返回 [scale, 0, 0, scale, offsetX, offsetY]，可直接喂给
 * `canvas.setViewportTransform`。
 */
export function fitViewport(
  containerW: number,
  containerH: number,
  docW: number,
  docH: number,
): ViewportTransform {
  const scale = fitScale(containerW, containerH, docW, docH);
  const offsetX = usable(containerW) ? (containerW - docW * scale) / 2 : 0;
  const offsetY = usable(containerH) ? (containerH - docH * scale) / 2 : 0;

  return [scale, 0, 0, scale, offsetX, offsetY];
}

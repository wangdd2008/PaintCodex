/**
 * 图层属性的本地预览通道（票 09）。
 *
 * 拖动透明度滑块时只能改屏幕上的 Fabric 对象，不能每个 `input` 都发 PATCH：
 * 撤销是快照级（ADR-0003），一次拖动必须只产生一个撤销步。`layerId` →
 * Fabric 对象的映射只存在于 `CanvasStage`，所以由它注册实现，图层面板只调用。
 */
type LayerOpacityPreviewHandler = (layerId: string, opacity: number) => void;

let handler: LayerOpacityPreviewHandler | null = null;

/** `CanvasStage` 挂载期间注册；卸载（含换画布）时传 `null` 注销。 */
export function setLayerOpacityPreviewHandler(
  next: LayerOpacityPreviewHandler | null,
): void {
  handler = next;
}

/**
 * 只改本地渲染，不发请求。没有画布或对象尚未装载时是安全的空操作：
 * 提交成功后快照同步会把 `opacity` 落到对象上。
 */
export function previewLayerOpacity(layerId: string, opacity: number): void {
  handler?.(layerId, opacity);
}

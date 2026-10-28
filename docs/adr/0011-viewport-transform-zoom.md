# ADR-0011: 画布缩放交给 Fabric 的 viewportTransform

## Status

Accepted — 2026-10-29.

## Context

画布从 Phase 1 起就没有缩放：1920×1080 的位图由 CSS 拉伸到容器宽度（`app.css:241-250`），状态栏的百分比是从渲染宽度反推的只读值（`viewport-store.ts:7-21`）。

只要不缩放，CSS 拉伸是成立的：没有交互需要坐标换算。但一旦要缩放和平移，它就崩了——CSS 的 `transform: scale()` 改变的是**渲染**，Fabric 仍然以为指针在文档坐标里，笔刷落点、对象命中、拖拽都会错位。补丁式修法是「在每处指针事件里除以缩放比」，那是把一个变换散进十几个事件处理器。

Fabric 6.9.1 已经提供 `viewportTransform` / `setViewportTransform` / `zoomToPoint` / `relativePan` 和 `mouse:wheel` 事件，只是全仓一次都没调用。

## Decision

缩放与平移由 Fabric 的视口变换承担，**文档坐标是唯一的坐标**：

- Fabric 画布尺寸 = 容器像素尺寸；文档尺寸仍来自 `canvasDocument.width/height`。
- `fitScale = min(containerW / docW, containerH / docH)`，`scale = fitScale * userZoom`，通过 `setViewportTransform([scale, 0, 0, scale, offsetX, offsetY])` 应用。
- 滚轮 → `zoomToPoint`（以指针为中心）；空格/中键拖拽 → `relativePan`；`scale` 限制在 `[0.05, 8]`。
- 叠加层（AI 高亮、选中定位）把文档坐标换算成屏幕像素：`x * scale + offsetX`。
- `.canvas-frame` 从 `aspect-ratio` 盒子变成视口（`overflow: hidden`），不再锁 16:9。

## Consequences

- **Positive**: 笔刷、命中测试、拖拽、导出全部自动正确——它们本来就只认文档坐标。
- **Positive**: 缩放比例有了单一真相（`viewportTransform`），状态栏不再靠 `ResizeObserver` 反推。
- **Positive**: 未来加「适应选区」「缩放动画」都只是改一个变换矩阵。
- **Negative**: 画布元素尺寸不再是文档尺寸，`canvas.toDataURL` 的导出需要显式按文档比例渲染（导出路径已有 multiplier 参数）。
- **Negative**: 叠加层不能再用 CSS 百分比定位，必须读 `viewportTransform`。
- **Trade-off**: 换来的是「一处变换、处处正确」，代价是缩放状态成了 `CanvasStage` 的一部分，需要抽纯函数才能测。

## Alternatives Considered

| Alternative | Rejected Because |
|---|---|
| CSS `transform: scale()` + 手写坐标换算 | 每个指针事件都要除以缩放比；漏一处就是笔刷偏移，且不可测 |
| 缩放时重建 Fabric 画布（改 `width`/`height`） | 每次缩放都丢对象状态与进行中的笔画 |
| 不做缩放 | 1920 文档在 1280 屏上只有 60%，细节无法处理 |
| 引入一个画布视口库 | Fabric 自带，引入等于为一个已有能力加依赖 |

## Migration Path

1. `.canvas-frame` 改为视口，去掉 `width: 100% !important` 的拉伸规则。
2. `CanvasStage` 用 `setDimensions` + `setViewportTransform` 初始化。
3. 抽 `fitScale` / `clampScale` / `docToScreen` 纯函数并单测。
4. 加滚轮、空格拖拽、中键拖拽、四个控件。
5. 叠加层改用像素定位。

# 04: Fabric 真缩放与平移

**What to build:** 用 `viewportTransform` 实现缩放/平移：滚轮缩放、空格/中键拖拽、适应/100%/± 控件。

**Blocked by:** None (can start immediately)

**Status:** done

**Size:** L

## Acceptance Criteria

- [x] `.canvas-frame` 改为占满可用空间的视口（`overflow: hidden`），不再锁 `aspect-ratio: 16/9`，不再强制 `canvas { width: 100% !important }`。
- [x] Fabric 画布尺寸 = 容器像素尺寸；文档尺寸仍取 `canvasDocument.width/height`。
- [x] 初始为 fit：`fitScale = min(cw/dw, ch/dh)`，内容居中。
- [x] 滚轮以指针为中心缩放：`zoomToPoint`，`scale` clamp 在 `[0.05, 8]`。
- [x] 空格按下 + 拖拽、或中键拖拽 → 平移（`relativePan`）；空格在输入框内不触发；松手恢复指针样式。
- [x] 画布区右下角控件：适应窗口 / 100% / − / +；点击可用，键盘可聚焦，有中文 `aria-label`。
- [x] 状态栏百分比来自当前 `scale`（`computeZoomPercent` 改造或替换），不再依赖 `ResizeObserver` 反推。
- [x] 容器尺寸变化时：fit 模式重算；手动缩放过则保持 `scale`。
- [x] 切画布与刷新都回到 fit（缩放不持久化）。
- [x] 纯函数 `fitScale` / `clampScale` / `docToScreen` 有单测（边界、clamp、缩放中心）。

## Notes

- 笔刷、命中、拖拽、导出都不改：它们只认文档坐标（ADR-0011）。
- 导出 PNG 走文档尺寸渲染，不要用当前的屏幕尺寸。
- 平移时保留 `canvas.selection = false` 的现状。


## Comments

- 2026-10-29 · 实现完成：`ddc4713`，合入 integration 分支 `feat/canvas-library-workspace-monitor`（merge `11d0916`）；经 code-review 双轴复查与统一修复（`4475df8`/`bdcc10a`）后验收全部满足，关闭。

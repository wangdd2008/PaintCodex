# 工作区布局与画布缩放

> 右栏只有 300px、对话被硬限高 280px、图层在上面抢高度、画布是 CSS 拉伸的 1920 位图。本轮把布局做成可调的，把缩放交给 Fabric。

## Problem Statement

1. **对话拥挤且不可调。** 右栏是固定 `300px` 的单列（`app.css:95`），图层面板最多吃掉 300px（`layer-panel.css:6`），对话 `min-height: 240px`；消息区被写死 `max-height: 280px`（`ai-chat.css:34-42`），气泡 `max-width: 88%`（`:51-56`）在 300px 里只有约 238px。面板加高也没用——`.ai-chat__body` 没有 `flex: 1`。全仓没有任何拖拽分栏。
2. **画布不能缩放。** 1920×1080 的位图被 `width: 100% !important` 拉伸（`app.css:241-250`），Fabric 的 `viewportTransform` 一次都没用过；状态栏的缩放率是从渲染宽度反推的只读值（`viewport-store.ts:7-21`）。
3. **有一份设计文档和现状矛盾。** `docs/architecture-design.md:323` 写「AI 对话面板：右侧属性面板下方可折叠抽屉，默认收起」，实现是默认展开、固定宽度。本轮把文档意图一并校准。

## Solution

- **两列右栏**：图层列 240px（可折叠）+ 对话列独立、可拖 320–640px、可收起，宽度记住。
- **垂直空间的账重新算**：消息区 `flex: 1`、去掉 280px 上限、气泡宽度跟着列宽走。
- **真缩放**：Fabric `viewportTransform` + 滚轮缩放 + 空格/中键平移 + 适应/100%/± 控件，文档坐标与笔刷宽度不变。
- **窄屏一个抽屉装两段**，不再分两个抽屉。

## User Stories

1. 作为用户，我想把对话面板拖宽，以便读长回复和长工具结果。
2. 作为用户，我想收起图层列，把整列高度让给对话。
3. 作为用户，我想让面板宽度被记住，不用每次打开都重新拖。
4. 作为键盘/读屏用户，我想用方向键调整分栏宽度。
5. 作为用户，我想用滚轮缩放画布、按住空格拖动画布，以便处理细节和看全貌。
6. 作为用户，我想一键「适应窗口」或回到 100%，并随时看到当前缩放。
7. 作为用户，缩放后 AI 的高亮框仍然贴住它指的那个图层。
8. 作为窄屏用户，我想一个抽屉里同时看到图层和对话。

## Scope

| # | 主题 | 票 |
|---|---|---|
| 1 | 右栏两列 + 可拖宽度 + 折叠 + 记忆 | 01 |
| 2 | 对话垂直空间修复（`flex:1`、去 280px 上限、气泡宽度） | 02 |
| 3 | 窄屏单抽屉两段 | 03 |
| 4 | Fabric 真缩放与平移 | 04 |
| 5 | 缩放/平移下的 AI 高亮与选区换算 | 05 |

## Implementation Decisions

### 1. 两列右栏

```css
.workspace {
  grid-template-columns: 56px minmax(0, 1fr) 240px var(--chat-width);
}
```

- `--chat-width` 默认 `380px`，范围 `320–640px`，写在 `document.documentElement.style`，来源 `localStorage['paintcodex.chatWidth']`。
- 拖动柄是两列之间一条 6px 的分隔条：`role="separator"`、`aria-orientation="vertical"`、`aria-valuenow/min/max`、`tabIndex=0`。
  - 鼠标：`pointerdown` + `setPointerCapture`，拖动时禁用文本选择与画布交互。
  - 键盘：`←`/`→` ±16px，`Home`/`End` 到最小/最大。
  - 双击复位到 380px。
- 对话列可整体收起（按钮在列头），收起后该列回到 0 并保留记住的宽度。
- 图层列固定 240px，**不可拖**；可折叠，折叠后剩一条纵向把手。

### 2. 垂直空间的账

- `.ai-chat__body { flex: 1; min-height: 0; }`
- `.ai-chat__messages { flex: 1; max-height: none; min-height: 48px; }` —— 删掉 `max-height: 280px`。
- `.ai-chat__message { max-width: 88%; }` 保留（比例语义没变，绝对宽度随列宽增长）。
- 图层面板：`max-height` 从固定 300px 改为 `min(360px, 50%)`，超出滚动；对话永远拿到剩余高度。
- 输入框保持 `rows={3}`，但允许 `resize: vertical`（已有）。

### 3. 窄屏（≤860px）

- 仍是覆盖式抽屉，但抽屉内部就是那两列：图层段在上（可折叠）、对话段在下且 `flex: 1`。
- 拖动柄在窄屏隐藏（宽度就是抽屉宽度）。
- ≤560px 时抽屉占满整宽（现有规则保留）。

### 4. 画布缩放：交给 `viewportTransform`

这是本 spec 的核心决定，单独记 ADR-0011。

- `.canvas-frame` 从「`aspect-ratio` 盒子」改成**视口**：占满 `.canvas-area` 的可用空间，`overflow: hidden`，不再强制 16:9。
- Fabric 画布尺寸 = 容器像素尺寸（`canvas.setDimensions`），文档尺寸仍来自 `canvasDocument.width/height`。
- 基础适配比例 `fitScale = min(cw / dw, ch / dh)`；实际比例 `scale = fitScale * userZoom`，通过 `canvas.setViewportTransform([scale, 0, 0, scale, offsetX, offsetY])` 应用。
- 交互：
  - 滚轮 → `canvas.zoomToPoint(new Point(e.offsetX, e.offsetY), nextScale)`，`scale` 限制在 `[0.05, 8]`。
  - 空格按下（`keydown`/`keyup`，窗口级，输入框内不触发）或鼠标中键 → 拖拽平移，`canvas.relativePan`。
  - 控件：画布区右下角悬浮「适应窗口 / 100% / − / +」，状态栏继续显示百分比。
  - 双击画布空白处 = 适应窗口？**不做**——双击在 Fabric 里可能与选择/编辑冲突。
- 模式：
  - `fit`：容器尺寸变化时重新算 `fitScale`。
  - `manual`：用户缩放过，容器变化时保持 `scale`，直到点「适应窗口」。
  - 「100%」= `scale = 1`（1 文档像素 = 1 CSS 像素）。
- 缩放不持久化：切画布或刷新回到 `fit`。
- 状态栏的 `zoomPercent` 改为直接来自当前 `scale`，不再用 `ResizeObserver` 反推。

### 5. 缩放下的叠加层

AI 高亮（`canvas-ai-highlight`）与选中定位目前用「画布框的百分比」定位（`CanvasStage.tsx:797-823`）。缩放/平移后必须换算：

- 文档坐标 → 屏幕坐标：`x * scale + offsetX`、`y * scale + offsetY`（`scale`/`offset` 直接读 `canvas.viewportTransform`）。
- 高亮层改为绝对像素定位（不再用百分比）。
- 平移/缩放过程中实时跟随；高亮到期逻辑（3 秒）不变。

## Testing Decisions

- 分栏：`chatWidth` 读/写 localStorage；键盘 ±16 与 clamp 边界；双击复位。
- 消息区：单测断言 CSS 契约难以做，改为组件测试中断言容器没有 `max-height` 内联样式 + 手动视觉验收。
- 缩放数学抽成纯函数（`fitScale`、`clampScale`、`docToScreen`）并单测；`CanvasStage` 只做接线。
- 平移/滚轮在 jsdom 里没有真实指针，只能测纯函数；交互验收走手动。

## Out of Scope

- 触控手势（双指捏合、双指平移）。
- 小地图、标尺、网格吸附。
- 每张画布记住各自的缩放/平移。
- 图层内的独立变换（缩放只作用于视图）。
- 缩放动画/惯性。

## Superseded Decisions

| 原决定 | 出处 | 本轮改为 |
|---|---|---|
| 对话面板固定 300px | `app.css:95` | 独立列，320–640px 可拖 |
| 消息区最高 280px | `ai-chat.css:34-42` | `flex: 1`，无上限 |
| 画布由 CSS 等比拉伸 | `app.css:206-250` | Fabric `viewportTransform` |
| 对话抽屉默认收起 | `docs/architecture-design.md:323` | 默认展开、可收起（保留「可折叠」意图，反转默认值） |

## Further Notes

- 缩放的语义要写进术语：它只改变渲染视图，不改变文档坐标、图层内容或笔刷宽度（`GLOSSARY.md`「缩放」）。
- 60px 的工具条、状态栏、菜单都不动。

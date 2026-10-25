# 画布、画笔与撤销

## 建画布后的现场状态

点击「新建画布」后：

```text
Untitled · 1920 × 1080
图层 / 暂无图层。
AI 对话 ▾ / 向绘画助手咨询构图、配色，或者下一步该画什么。
状态栏：1920 × 1080 | 缩放: 100% | 画笔
```

- 画布名固定为 `Untitled`，没有重命名入口（DOM 中是 `span.document-name`）。
- 画布名称同时出现在菜单栏、画布下方 hint、图层面板语境中。
- 顶部「新建画布」「导出 PNG」「导出 JSON」「监控」均可用。

## 画笔现场测试

点击「画笔」，在画布上拖拽一条路径后：

- 图层面板出现 `Stroke 1`，类型显示 `vector`。
- 撤销按钮从禁用变为可用。
- 路径保存到 daemon，刷新后仍存在。
- 连续画 7 条，图层命名为 `Stroke 1` … `Stroke 8`。
- 画笔固定颜色 `#111111`、固定宽度 `4`（内部 1920 宽度坐标），没有颜色、粗细、硬度或笔刷预览控件。
- 画布显示宽度约 858px，内部 1920px；4px 内部笔宽在屏幕上约 1.8px，视觉上很细。

## 状态栏“缩放: 100%”与真实缩放不一致

同一时刻读取：

```json
{
  "viewport": [1264, 625],
  "canvasScreen": { "x": 81, "y": 69, "w": 858, "h": 481.75 },
  "scale": 0.4479166666666667,
  "status": ["1920 × 1080", "缩放: 100%", "画笔"]
}
```

实际显示缩放约 **44.8%**，状态栏仍写 **100%**。`App.tsx` 中该值是硬编码字符串，不是真实缩放。

## 撤销 / 重做

- 工具栏按钮可用状态会随历史变化。
- `Ctrl+Z`、`Ctrl+Y`、`Ctrl+Shift+Z` 可用；输入框聚焦时不会拦截。
- 隐藏图层后点撤销可以恢复可见性（现场验证）。
- 按钮的快捷键只出现在 `title` 中，界面没有常驻提示。

## 图层命名重复

现场步骤：画到 `Stroke 8` → 删除中间的 `Stroke 4` → 再画一条。

结果：

```json
["Stroke 1","Stroke 2","Stroke 3","Stroke 5","Stroke 6","Stroke 7","Stroke 8","Stroke 8"]
```

命名逻辑使用 `current.layers.length + 1`，删除中间层后会产生重名。图层面板、删除确认、无障碍名称都会出现两个 `Stroke 8`。

## 自动“保存”实际是每 30 秒下载 JSON

`App.tsx` 中有：

```ts
// Auto-save: export JSON every 30 seconds when a canvas is active
const interval = window.setInterval(() => {
  downloadCanvasJson(canvas, canvasJsonFilename(canvas.name));
}, 30_000);
```

现场在新建画布后等待 33 秒，拦截 `HTMLAnchorElement.prototype.click` 计数：

```json
{ "downloads": 1, "name": "Untitled", "url": "http://localhost:5173/?canvasId=..." }
```

即：**画布空闲 30 秒后会自动向浏览器下载一个 `Untitled.json`。** 每次画布状态变化都会重置这个定时器，所以它会在用户停笔 30 秒后触发。headless 浏览器不会弹下载确认，真实浏览器会不断产生下载文件。

## 画布提示与状态信息重复

- 菜单栏：`Untitled`
- 画布下方：`Untitled · 1920 × 1080`
- 状态栏：`1920 × 1080`
- 状态栏：`缩放: 100%`（不真实）

缺少的是：保存状态、连接状态、当前图层、实际缩放。

## 可引用的源码位置

- `apps/web/src/features/canvas/CanvasStage.tsx`：`BRUSH_COLOR`、`BRUSH_WIDTH`、`path:created`。
- `apps/web/src/app/App.tsx`：30 秒自动下载、硬编码 `缩放: 100%`。
- `apps/web/src/services/json-export.ts`：`downloadCanvasJson` 通过 anchor 触发下载。
- `apps/web/src/features/toolbox/Toolbox.tsx`：工具按钮与快捷键 title。
- `apps/web/src/services/canvas-store.ts`：重命名/画布管理入口缺失。

## 待 PM 判断

1. 自动下载是否应直接移除，改为服务端保存 + 明确的保存状态？
2. “缩放 100%”应修正为真实缩放，还是补上 zoom 控件？
3. 画笔缺少颜色/粗细是否属于“完善现有能力”而非新模块？
4. 图层重名是否会造成删除误操作？优先级多高？

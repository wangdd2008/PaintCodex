# 首次进入与空状态

## 现场快照（无画布）

无 `canvasId`、无 localStorage 记录时打开 `http://localhost:5173`，可访问性树：

```text
PaintCodex 新建画布 导出 PNG 导出 JSON 监控
画笔 选择 撤销 重做
Blank 1920 × 1080 canvas
图层 / 尚未加载画布。
AI 对话 ▾ / 向绘画助手咨询构图、配色，或者下一步该画什么。
```

具体状态：

- 「新建画布」是唯一可用的创建入口，位于右上角菜单栏。
- 「导出 PNG」「导出 JSON」禁用。
- 画笔、选择按钮可用；撤销、重做禁用。
- 画布区域已经渲染一张 1920×1080 的白色画布，但并没有对应画布文档。
- 画布下方提示为英文：`Blank 1920 × 1080 canvas`。
- 图层面板空状态：`尚未加载画布。`
- AI 输入框可用，空状态文案正常。

## 关键现场测试：未建画布直接画

在无画布状态下点击「画笔」，在画布上拖出一条线，等待 800ms 后：

```json
{
  "layers": 0,
  "nonWhitePixels": 0,
  "error": null,
  "undoDisabled": true,
  "hint": "Blank 1920 × 1080 canvas"
}
```

结论：**笔画被静默丢弃，没有任何提示、错误或引导。** 画笔按钮在无画布时仍然可点，画布也看起来可画，但 `CanvasStage` 的 `path:created` 处理在 `current` 为空时会直接 `canvas.remove(path)`。

## 关键现场测试：未建画布直接聊天

在无画布状态下发送「你好」，AI 正常回复：

> 你好！我是 PaintCodex 的绘画助手。想聊天，还是让我在画布上添加一层新的矢量图形？

没有报错，也没有提示“请先新建画布”。如果用户继续让 AI 画，当前前端没有画布可承载图层。

## 空状态 CTA 评估

- 画布区域只有提示文本，没有「新建画布」按钮或“从这里开始”的引导。
- 唯一 CTA 在右上角，与 brand、导出、监控混在一起，首次用户需要自己寻找。
- 图层面板说“尚未加载画布”，但没有告诉用户如何加载。
- 空状态没有解释“画布 / 图层 / AI 图层”三者关系。

## 可引用的源码位置

- `apps/web/src/features/canvas/CanvasStage.tsx`：`handlePathCreated` 在 `!current` 时移除路径。
- `apps/web/src/app/App.tsx`：只有菜单栏「新建画布」入口。
- `apps/web/src/features/layer-panel/LayerPanel.tsx`：`尚未加载画布。`。
- `apps/web/index.html`：`<html lang="en">`。

## 待 PM 判断

1. 首次进入是否应该自动创建画布，或在画布区提供主 CTA？
2. 无画布时画笔/AI 输入是否应禁用，或操作时自动创建画布？
3. “看起来能画但画了消失”应定为 P0 还是 P1？

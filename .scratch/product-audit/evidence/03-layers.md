# 图层、选择与面板布局

## 图层列表现场结构

一条笔迹图层在可访问性树中：

```text
listitem "● Stroke 1 vector ×" [clickable, cursor:pointer]
  button "隐藏 Stroke 1"
  button "删除 Stroke 1"
```

- 图层行本身是 `<li>`，有 `onClick`，但 `tabIndex = -1`、没有 `role`、没有键盘事件。
- 只有可见性按钮和删除按钮可通过 Tab 到达。
- 名称、类型、可见性状态都是文本，没有可编辑输入。
- 类型显示 `vector`（英文），AI 图层显示 `✦ AI`。
- 当前图层只通过边框/背景色区分（`layer-item--active`），画布上不会出现对应轮廓（笔迹图层不可选中）。

## 目标尺寸（1264×625 视口）

```json
[
  {"name":"隐藏 Stroke 1","w":7,"h":11},
  {"name":"删除 Stroke 1","w":16,"h":16}
]
```

- 可见性按钮 **7×11 px**，删除按钮 **16×16 px**。
- 工具按钮约 39×36 px，菜单按钮高 32 px。
- 明显低于常见的 44×44 触控目标，也远小于鼠标精确点击的舒适区。

## 可见性切换语义

现场点击后：

```json
{ "label": "显示 Stroke 1", "pressed": "false", "nonWhitePixels": 9203 }
```

点击前非白像素为 13165，隐藏后降到 9203，说明隐藏生效。

但按钮的 `aria-label` 是动作（“隐藏/显示”），`aria-pressed` 是状态（true/false），屏幕阅读器会读成“显示 Stroke 1，切换按钮，未按下”，容易产生歧义。更清晰的做法是标签固定为“Stroke 1 可见性”，用 pressed 表示当前是否可见，或使用 `aria-label` 只描述状态。

## 删除流程

- 点击删除会调用 `window.confirm('删除图层 "xxx"?')`。
- 现场浏览器默认自动取消原生 confirm；没有自定义确认弹层。
- 删除后没有 toast，也没有“已删除，撤销”入口；只能依赖工具栏撤销。
- 删除按钮本身没有二次确认的视觉提示（只有原生弹窗）。

### 删除后撤销补测（主 agent 于审计后验证）

现场：9 层 → 删除 `Stroke 9` → 点击工具栏「撤销」。

```json
{
  "before": 9,
  "afterDelete": 8,
  "afterUndo": 9,
  "namesAfterUndo": ["Stroke 1","Stroke 2","Stroke 3","Stroke 5","Stroke 6","Stroke 7","Stroke 8","Stroke 8","Stroke 9"]
}
```

结论：**删除图层可以通过现有快照撤销恢复**。问题不在“不可恢复”，而在删除后没有任何“已删除，可撤销”的反馈，用户不知道可以恢复。删除确认弹窗可以改为“直接删除 + 8 秒撤销条”，由现有 undo 机制承接。

## 图层能力缺口

数据模型和协议支持：

- `opacity`（0–1）
- `zIndex`
- `name`
- `visible`

UI 只暴露了 `visible` 和删除。没有：

- 重命名
- 透明度
- 拖拽排序 / 上移下移
- 合并
- 锁定
- 图层搜索/筛选

其中 `opacity`、`name`、`zIndex` 是已有数据能力没有 surfaced，属于“完善现有能力”的候选。

## 面板布局与图层增长

单图层时：

- 图层面板高约 90px，AI 对话占剩余高度约 467px。

8 个图层时：

```json
{
  "layerPanel": { "h": 370, "scrollH": 369 },
  "sidePanel": { "h": 556.75, "scrollH": 595, "scrollTop": 0 },
  "chat": { "y": 414, "h": 186.75, "bottom": 600.75 },
  "viewport": [1264, 625]
}
```

- 侧栏内容总高 595 > 可视高度 556.75，出现整体滚动。
- AI 对话被压缩到 186.75px，底部已经接近/超过状态栏上方边界（chat bottom 600.75，工作区底部约 597）。
- 图层继续增加时，AI 对话会被推到折叠线以下，用户需要滚动整个侧栏才能看到输入框。
- 图层面板没有独立滚动区，也没有折叠/拖拽分隔条。

## 图层选择与变换

- 「选择」工具的 title 是“选择和移动 AI 图层”。
- 只有 `type === 'ai-generated'` 的图层在 select 模式下 `selectable/evented`。
- 笔迹图层（vector）不能被选择、移动、缩放；用户只能通过图层面板隐藏/删除。
- 点击图层面板中的笔迹图层只改变 active 状态，画布上没有反馈。

## 多标签同步

- 打开同一 `canvasId` 的第二个标签页，图层与可见性状态一致。
- 在第二个标签页画一条线，第一个标签页 1.2 秒内从 8 层变为 9 层，实时同步生效。
- 画布界面没有“实时连接中/已断开”指示；SSE `onError` 在 `App.tsx` 中没有被使用。

## 可引用的源码位置

- `apps/web/src/features/layer-panel/LayerPanel.tsx`：`<li onClick>`、`window.confirm`、无重命名/透明度。
- `apps/web/src/features/layer-panel/layer-panel.css`：可见性 11px、删除 16px。
- `apps/web/src/features/canvas/CanvasStage.tsx`：只有 AI 图层可选中。
- `apps/web/src/app/app.css`：`.side-panel` 整体滚动，图层与 AI 面板固定分配。
- `packages/protocol/src/index.ts`：Layer 的 `opacity`、`zIndex` 字段。

## 待 PM 判断

1. 7×11 的可见性按钮应定为 P0（不可用）还是 P1（体验差）？
2. 图层重命名/透明度/排序中，哪些属于本轮“完善现有能力”必须做？
3. 笔迹不可选中是 Phase 1 合理边界，还是用户预期落差？
4. 图层增长挤压 AI 对话，优先做独立滚动还是可折叠/可拖拽面板？

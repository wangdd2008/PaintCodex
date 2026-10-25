# 导出、持久化与画布管理

## PNG / JSON 导出

拦截 anchor 下载后的现场记录：

```json
[
  { "name": "Untitled.png", "prefix": "blob:http://localhost:5173/..." },
  { "name": "Untitled.json", "prefix": "blob:http://localhost:5173/..." }
]
```

- 导出按钮在有画布时可用，无画布时禁用。
- 文件名来自 `canvas.name`；新画布固定 `Untitled`，所以所有导出都叫 `Untitled.png` / `Untitled.json`。
- 没有“导出成功”反馈，也没有导出尺寸/格式选项。
- PNG 由当前 Fabric canvas 的 `toDataURL({ format: 'png', multiplier: 1 })` 生成，内部尺寸 1920×1080。
- JSON 包含 `version: "1.0"`、`exportedAt`、完整 `canvas`；没有导入入口。

## 自动下载与手动导出的冲突

- 手动导出是显式操作，有明确按钮。
- 自动“保存”每 30 秒触发同样的 anchor 下载（见 `02-canvas-brush.md`）。
- 用户无法区分“自动保存”与“导出”，真实浏览器会累积下载文件。
- 服务端本身已经逐次保存 mutation；这个下载并不承担持久化职责。

## 刷新持久化

在 AI 画布上刷新：

```json
{
  "layers": ["AI — 红色圆形"],
  "chat": "向绘画助手咨询构图、配色，或者下一步该画什么。",
  "stored": "7e93fd98-...",
  "url": "http://localhost:5173/?canvasId=7e93fd98-..."
}
```

- 画布、图层、修订都保留。
- URL 恢复 `canvasId`，localStorage 也保存 `paintcodex.canvasId`。
- AI 对话、草稿、当前工具、当前选中图层不持久化；当前工具刷新后回到画笔。

## 新建画布会“丢”掉旧画布入口

现场步骤：

1. 当前 URL：`?canvasId=ffbd57e5-...`，localStorage 同 id，history.length=2。
2. 点击「新建画布」，没有确认弹窗。
3. URL 变成 `?canvasId=247c67e1-...`，localStorage 变成新 id，history.length 仍为 2。
4. `history.back()` 直接离开应用（到空白页），没有回到旧画布。

结论：

- 新建画布使用 `history.replaceState`，旧画布的 URL 不进入历史。
- localStorage 被覆盖，UI 没有“最近画布”或“打开画布”入口。
- 旧画布仍存在 SQLite 中，但普通用户已经无法从界面找回，除非手动保存过旧 URL。
- 没有“未保存内容”确认；虽然服务端已保存，但用户感知是“我的画不见了”。

## 画布命名

- 新画布名称固定为 `Untitled`。
- 菜单栏画布名是 `<span>`，没有点击编辑、铅笔图标或双击重命名。
- 没有创建时命名步骤。
- 导出文件名、画布 hint、图层面板语境都使用这个名称。

## 错误与空状态

- 加载不存在的 canvasId 时，`loadCanvas` 会清除 localStorage 并在菜单栏显示错误；画布区回到空白，没有“新建画布”主 CTA。
- 导出异常会显示在菜单栏 `menu-status`，样式是 12px 红字，容易被忽略。
- 没有“保存中/已保存/保存失败”的状态指示；`saving` 只用于禁用部分按钮。

## 可引用的源码位置

- `apps/web/src/services/png-export.ts`、`apps/web/src/services/json-export.ts`：文件名与下载。
- `apps/web/src/services/canvas-store.ts`：`rememberCanvas` 使用 `replaceState`，只保存一个 id。
- `apps/web/src/app/App.tsx`：导出处理、错误显示、自动下载。
- `apps/web/src/services/canvas-engine.ts`：PNG 导出使用 live canvas。

## 待 PM 判断

1. 新建画布前是否必须确认？旧画布是否需要一个最小“最近画布”入口？
2. 画布重命名是否应作为本轮 P0/P1？
3. 自动下载移除后，保存状态应该怎样呈现？
4. JSON 没有导入入口——导出是否应该标注“仅备份”，避免用户期待可恢复？

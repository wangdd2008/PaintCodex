# 03: 画布库卡片 meta 分层（快赢 3）

**What to build:** 库卡片 meta 从一行 `·` 分隔改为两行结构（尺寸×层数 / 相对时间），去掉模板化分隔符。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

**Covers:** ui-visual-polish spec §Implementation Decisions 3

**Size:** S

## Acceptance Criteria

- [ ] 卡片体 meta 拆为两行：第一行 `尺寸 × 层数`，第二行相对更新时间。
- [ ] 文本内容不变：仍渲染 `1280 × 720`、`0 层`、`分钟前/小时前/天前/刚刚`，现有 `canvas-library.test.tsx` 的文本断言（`/1280 × 720/`、`/0 层/`、相对时间存在性）全部保持成立。
- [ ] 时间行比信息行低一级明度（muted/faint 层级），信息分层而非装饰。
- [ ] 画布库截图确认两行结构可读、无溢出。

## Notes

- 改动 `CanvasLibraryPage.tsx` 的卡片体渲染与 `canvas-library.css` 的 meta 样式。
- 只拆 meta 呈现，不动名称、缩略图、删除/重命名交互。

## Comments

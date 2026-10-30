# 05: 画布空态质感（快赢 4）

**What to build:** 空态（无画布/加载失败等）从虚线边框改为实色底 + 细点阵底纹，保留全部文案与按钮锚点。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

**Covers:** ui-visual-polish spec §Implementation Decisions 4

**Size:** S

## Acceptance Criteria

- [ ] `.canvas-gate` 虚线边框（`border: 1px dashed var(--control)`）改为实色底 + 细点阵/极淡网格底纹。
- [ ] 底纹透明度低到不妨碍标题、描述与按钮阅读。
- [ ] `.canvas-gate` 类名与 `canvas-gate__title/description/reason/actions` 结构不变。
- [ ] 文案与按钮不变：还没有画布 / 开始一张画布 / 重试 / 新建画布。
- [ ] `canvas-gate.test.tsx` 全部断言（文案、按钮、类名）保持成立。
- [ ] 空态主操作（反白按钮）与其他状态一致。

## Notes

- 只改 `app.css` 的 `.canvas-gate` 段落。
- 点阵用 `radial-gradient` 重复背景实现，不引入图片资源。
- 验收需覆盖无画布、加载失败（若有）两种空态截图。

## Comments

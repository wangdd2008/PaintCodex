# 03: 窄屏单抽屉两段

**What to build:** ≤860px 的抽屉里同时容纳图层段与对话段，不再需要两个独立入口。

**Blocked by:** 01, 02

**Status:** done

**Size:** S

## Acceptance Criteria

- [x] 抽屉内部是纵向两段：图层段在上（最高 `min(360px, 50%)`，可折叠）、对话段在下且 `flex: 1`。
- [x] 分隔条在 ≤860px 隐藏；抽屉宽度仍为 `min(320px, 86vw)`，≤560px 占满整宽。
- [x] 抽屉打开时滚动只发生在图层列表与消息列表内部，抽屉本身不滚。
- [x] Esc 关闭抽屉后焦点回到「图层」按钮（现有行为保留）。
- [x] 390×844 下手测：抽屉打开后能同时看到至少 2 行图层与 2 条消息。

## Notes

- 不新增第二个抽屉按钮；顶部「图层」按钮打开的就是这个两段抽屉。


## Comments

- 2026-10-29 · 实现完成：`e99fe2b`，合入 integration 分支 `feat/canvas-library-workspace-monitor`（merge `3b68b1c`）；经 code-review 双轴复查与统一修复（`4475df8`/`bdcc10a`）后验收全部满足，关闭。

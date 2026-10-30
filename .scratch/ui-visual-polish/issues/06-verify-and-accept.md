# 06: 回归与三视图视觉验收（收尾）

**What to build:** 全量回归 + 三视图截图验收，逐项核对 01–05 验收标准后关闭全部实现票。

**Blocked by:** 01, 02, 03, 04, 05

**Status:** ready-for-agent

**Covers:** ui-visual-polish spec §Testing Decisions

**Size:** S

## Acceptance Criteria

- [ ] `pnpm --filter @paintcodex/web test` 全绿（重点：canvas-library、canvas-gate、layer-panel、app-route、narrow-viewport）。
- [ ] 画布工作区截图：卡片圆角变锐利、标题字号变大、空态点阵底纹无虚线框。
- [ ] 画布库截图：meta 两行分层、hover 边框+缩略图放大、卡片圆角继承。
- [ ] 监控页截图：统计卡片圆角继承、无布局破坏。
- [ ] 键盘 Tab 遍历库卡片与空态按钮，focus 可见。
- [ ] 验收记录写入本票 Comments，并给出关闭所用 commit。

## Notes

- 视觉验收用 dev server（daemon :3210 + web :5173）+ 浏览器截图对比基线。
- 任一验收项失败即回改对应实现票，不降级关闭。

## Comments

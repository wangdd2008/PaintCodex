# 06: 图层面板布局

**What to build:** 图层增长不再挤压 AI 对话：图层面板限高并独立滚动，AI 面板保底高度，侧栏不再整体滚动。

**Blocked by:** None (can start immediately)

**Status:** done

**Covers:** UX-11

**Size:** S

## Acceptance Criteria

- [x] 侧栏 `overflow: hidden`；图层面板 `max-height: 300px` 且图层列表独立滚动；AI 面板 `flex: 1; min-height: 240px`。
- [ ] 8 层时聊天区高度 ≥240px，输入框与发送按钮完整可见。
- [ ] 20 层时侧栏无整体滚动条（`scrollHeight ≤ clientHeight`）。
- [x] 新图层自动 `scrollIntoView({ block: 'nearest' })` 进入可视区。
- [ ] 1264×625、8 层下断言：侧栏 `scrollHeight ≤ clientHeight`，聊天区 `offsetHeight ≥ 240`。

## Notes

- 现状 8 层：侧栏 595 > 可用 556.75，聊天区从 467 压到 186.75。
- 本票是票 07、08、14 的前置：命中区、键盘导航、窄屏抽屉都依赖面板已经能独立滚动。

## Comments

**2026-10-26 — implementation commit `1bc0783`**

- 实现：`apps/web/src/app/app.css` 侧栏改 `overflow: hidden`，新增 `.side-panel > .ai-chat { flex: 1; min-height: 240px; }`；`apps/web/src/features/layer-panel/layer-panel.css` 面板改为限高 300px 的纵向 flex（`max-height: 300px`），列表 `flex: 1 1 auto; min-height: 0; overflow-y: auto` 接管滚动；`LayerPanel.tsx` 的 `<ul>` 成为滚动容器并带 `ref`，effect 只在**同一画布新增图层**时对最新一层调用 `scrollIntoView({ block: 'nearest' })`（切换画布只重置基线、既有图层更新不滚动）。
- 测试：`pnpm --filter @paintcodex/web test` 通过 68/68（新增 `apps/web/test/layer-panel-layout.test.ts` 5 条）；`pnpm -r typecheck` 三个包全部通过。
- CSS 契约（jsdom 无法计算布局）：`max-height: 300px`、列表 `overflow-y`、侧栏 `overflow: hidden`、AI 面板 `flex/min-height` 用样式文件文本断言；滚动容器存在、新图层 `scrollIntoView` 用组件测试 + spy 断言（含「既有图层更新不滚动」回归）。
- 需人工/浏览器在 1264×625 复核（验收 2、3、5 因此保持未勾选）：8 层时聊天区 `offsetHeight ≥ 240` 且输入框与发送按钮完整可见；20 层时侧栏 `scrollHeight ≤ clientHeight`；新图层在真实滚动容器中视觉上进入可视区。
- 范围说明：未改命中区、键盘导航、选中语义与列表方向（票 07、08、14 的内容）；未引入新依赖。

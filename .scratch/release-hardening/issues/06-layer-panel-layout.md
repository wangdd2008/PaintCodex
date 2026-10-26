# 06: 图层面板布局

**What to build:** 图层增长不再挤压 AI 对话：图层面板限高并独立滚动，AI 面板保底高度，侧栏不再整体滚动。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

**Covers:** UX-11

**Size:** S

## Acceptance Criteria

- [ ] 侧栏 `overflow: hidden`；图层面板 `max-height: 300px` 且图层列表独立滚动；AI 面板 `flex: 1; min-height: 240px`。
- [ ] 8 层时聊天区高度 ≥240px，输入框与发送按钮完整可见。
- [ ] 20 层时侧栏无整体滚动条（`scrollHeight ≤ clientHeight`）。
- [ ] 新图层自动 `scrollIntoView({ block: 'nearest' })` 进入可视区。
- [ ] 1264×625、8 层下断言：侧栏 `scrollHeight ≤ clientHeight`，聊天区 `offsetHeight ≥ 240`。

## Notes

- 现状 8 层：侧栏 595 > 可用 556.75，聊天区从 467 压到 186.75。
- 本票是票 07、08、14 的前置：命中区、键盘导航、窄屏抽屉都依赖面板已经能独立滚动。

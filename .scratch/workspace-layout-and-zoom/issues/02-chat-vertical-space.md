# 02: 对话垂直空间修复

**What to build:** 消息区不再被 280px 硬顶，多余高度归消息列表，气泡宽度随列宽增长。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

**Size:** S

## Acceptance Criteria

- [ ] `.ai-chat__body` 加 `flex: 1; min-height: 0;`。
- [ ] `.ai-chat__messages` 改 `flex: 1; max-height: none; min-height: 48px;`（删除 280px 上限）。
- [ ] `.ai-chat__message` 保留 `max-width: 88%`，不再出现 ~238px 的绝对卡点。
- [ ] 图层面板 `max-height` 从固定 300px 改为 `min(360px, 50%)`，内容超出滚动。
- [ ] 对话列高度为 600px 时，消息区可见高度 ≥ 360px（当前上限 280px）。
- [ ] 输入框保持 `rows={3}` 与 `resize: vertical`。
- [ ] 收起/展开对话列后高度重算正确，无内容被裁切。

## Notes

- 只改布局，不改消息渲染与滚动行为。
- 手动验收：面板拉到 640px 宽时，长回复换行自然、不出现水平滚动。

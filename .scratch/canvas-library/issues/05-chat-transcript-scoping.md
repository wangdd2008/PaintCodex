# 05: 会话记录按画布分区

**What to build:** `messages` 从面板内部状态升级为按 `canvasId` 分区的会话态存储；切走画布即中断在飞请求。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

**Covers:** 画布库 §6

**Size:** M

## Acceptance Criteria

- [ ] 新增 `useChatStore`：`transcripts: Record<string, ChatMessage[]>`，键为 `canvasId`。
- [ ] `AiChatPanel` 的所有 `setMessages` 改为写入 `transcripts[runCanvasId ?? 当前 canvasId]`；切换画布后渲染的永远是当前画布的桶。
- [ ] 新建画布后显示空会话（旧画布的气泡不再出现）。
- [ ] 一次 AI 回复进行中切走画布：调用 `abort()`，向**发起时那张**画布的桶追加一条「已取消」，新画布不受影响。
- [ ] 在没有画布的状态下不显示任何历史（空态），输入框仍禁用并提示先新建画布。
- [ ] 刷新页面后所有桶清空（会话态，沿用 UX-24），不新增服务端表。
- [ ] 组件测试覆盖：新建后旧消息不可见；切回本会话内旧画布可见其消息；切走时 abort 被调用。

## Notes

- `runCanvasId` 已存在（`AiChatPanel.tsx:348-349`），本票只是让写入目标用它而不是「当前画布」。
- 不设条数上限；不写 localStorage、不写 sessionStorage。
- `ChatMessage` 不新增 `canvasId` 字段——桶的键已经表达了归属。

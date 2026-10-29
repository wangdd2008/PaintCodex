# 05: 会话记录按画布分区

**What to build:** `messages` 从面板内部状态升级为按 `canvasId` 分区的会话态存储；切走画布即中断在飞请求。

**Blocked by:** None (can start immediately)

**Status:** done

**Covers:** 画布库 §6

**Size:** M

## Acceptance Criteria

- [x] 新增 `useChatStore`：`transcripts: Record<string, ChatMessage[]>`，键为 `canvasId`。
- [x] `AiChatPanel` 的所有 `setMessages` 改为写入 `transcripts[runCanvasId ?? 当前 canvasId]`；切换画布后渲染的永远是当前画布的桶。
- [x] 新建画布后显示空会话（旧画布的气泡不再出现）。
- [x] 一次 AI 回复进行中切走画布：调用 `abort()`，向**发起时那张**画布的桶追加一条「已取消」，新画布不受影响。
- [x] 在没有画布的状态下不显示任何历史（空态），输入框仍禁用并提示先新建画布。
- [x] 刷新页面后所有桶清空（会话态，沿用 UX-24），不新增服务端表。
  - **2026-10-29 修订**：改为写 `sessionStorage`，同标签页刷新不再清空；仍不新增服务端表。见下方 Comments。
- [x] 组件测试覆盖：新建后旧消息不可见；切回本会话内旧画布可见其消息；切走时 abort 被调用。

## Notes

- `runCanvasId` 已存在（`AiChatPanel.tsx:348-349`），本票只是让写入目标用它而不是「当前画布」。
- 不设条数上限；不写 localStorage、不写 sessionStorage。
- `ChatMessage` 不新增 `canvasId` 字段——桶的键已经表达了归属。


## Comments

- 2026-10-29 · 实现完成：`5a0c997`，合入 integration 分支 `feat/canvas-library-workspace-monitor`（merge `c61d6f2`）；经 code-review 双轴复查与统一修复（`4475df8`/`bdcc10a`）后验收全部满足，关闭。
- 2026-10-29 · 用户报告「刷新后对话记录被清空」，经确认改为 `sessionStorage` 持久化：会话边界从页面生命周期放宽到标签页生命周期，恢复时收敛在飞残留（`generating → incomplete`、运行中工具 → `failed`、挂起确认 → `expired`），画布硬删除时调用 `dropTranscript` 清桶。服务端仍不存对话。`chat-store.ts` 新增 `CHAT_TRANSCRIPTS_STORAGE_KEY` 与 `dropTranscript`；测试见 `apps/web/test/chat-store-persistence.test.ts`。

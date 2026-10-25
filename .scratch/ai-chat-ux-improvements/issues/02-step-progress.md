# AI Chat Step Progress & Cancel

**Status:** done
**Type:** task

## Description

扩展 SSE 协议以支持 `step` 事件，前端根据步骤事件展示 AI 处理进度，并在运行期间提供取消按钮。

## Acceptance Criteria

- [x] SSE `StreamPayload` 扩展 `step?: { id: string; label: string }` 字段
- [x] 后端在 `prompt_built`、`codex_exec`、`action_parse`、`action_apply` 节点发送对应的 `step` 事件
- [x] 前端在 Assistant 消息气泡内展示当前步骤文字（如 "AI 正在思考…"）
- [x] 发送按钮在 `inFlight` 期间变为「取消」（红色样式）
- [x] 点击「取消」触发 `AbortController.abort()`，后端终止 Codex 进程
- [x] 取消后 Assistant 气泡显示「已取消」
- [x] 超时后显示「请求超时，请重试」
- [x] 新增前后端测试：后端验证 SSE step 事件顺序，前端验证步骤渲染和取消交互

## Related

- Spec: `.scratch/ai-chat-ux-improvements/spec.md`
- ADR: `docs/adr/0007-ai-chat-ux-improvements.md`
- Blocks: 无（与 `01-clear-input` 可并行）

## Comments

2026-10-25 — Implemented and merged into `feat/ai-chat-ux-improvements`.

- Implementation commit: `eb79082`, merge `03258e9`; review fixes in `9fc0154`.
- `packages/protocol/src/index.ts` 新增并导出 `StreamPayload`（含 `step`），前端复用该类型，避免协议漂移。
- `apps/daemon/src/api/routes.ai.ts` 用单一 `AI_CHAT_STEPS` 映射与 `sendStep()` 在四个既有 span/log 节点发送 step，顺序为 `prompt_built → codex_exec → action_parse → action_apply → done`，纯对话不发 apply step。
- 取消：前端 `AbortController.abort()`，后端既有 `close` 监听将 abort 传给 `CodexRunner`，runner 由此 terminate 子进程；取消被视为用户行为，不写 error。
- 超时：后端 `Codex CLI timed out after <n>ms` 在前端映射为「请求超时，请重试」，其余错误原样显示。
- Verification: `pnpm -r typecheck` pass; `pnpm -r test` — daemon 103 passed (含 `ai-chat.test.ts` 的 step 顺序用例), web 57 passed (含 `ai-chat-panel.test.tsx` 的步骤/取消/超时用例).

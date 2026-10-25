# AI Chat Step Progress & Cancel

**Status:** ready-for-agent
**Type:** task

## Description

扩展 SSE 协议以支持 `step` 事件，前端根据步骤事件展示 AI 处理进度，并在运行期间提供取消按钮。

## Acceptance Criteria

1. SSE `StreamPayload` 扩展 `step?: { id: string; label: string }` 字段
2. 后端在 `prompt_built`、`codex_exec`、`action_parse`、`action_apply` 节点发送对应的 `step` 事件
3. 前端在 Assistant 消息气泡内展示当前步骤文字（如 "AI 正在思考…"）
4. 发送按钮在 `inFlight` 期间变为「取消」（红色样式）
5. 点击「取消」触发 `AbortController.abort()`，后端终止 Codex 进程
6. 取消后 Assistant 气泡显示「已取消」
7. 超时后显示「请求超时，请重试」
8. 新增前后端测试：后端验证 SSE step 事件顺序，前端验证步骤渲染和取消交互

## Related

- Spec: `.scratch/ai-chat-ux-improvements/spec.md`
- ADR: `docs/adr/0007-ai-chat-ux-improvements.md`
- Blocks: 无（与 `01-clear-input` 可并行）

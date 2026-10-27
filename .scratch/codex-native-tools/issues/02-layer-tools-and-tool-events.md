# 02: 图层改写/删除/撤销工具与工具事件行

**What to build:** 补齐 `canvas_update_layer` / `canvas_delete_layer` / `canvas_undo` 三个工具，把工具调用作为一等事件推给前端，并让写操作在对话里成行显示。

**Blocked by:** 01、05

**Status:** ready-for-agent

- [ ] `canvas_update_layer`：`{ canvasId, layerId, patch }` → `canvas_update_layer`；SVG patch 过 `isSafeSvg`
- [ ] `canvas_delete_layer`：`{ canvasId, layerId }` → `canvas_delete_layer`（本票先直接执行，确认在 03 接入）
- [ ] `canvas_undo`：仅当撤销栈顶快照的 actor 为 `agent` 时执行；否则返回 `{ ok:false, code:'top_action_is_user' }`
- [ ] 工具失败统一为 `{ ok:false, code, message }`；删除 daemon 侧 `MAX_ACTION_RETRIES` 静默重试，`revision_conflict` 附 `currentRevision` 回给模型
- [ ] `StreamPayload` 增加 `tool` 帧；Runtime 把 `ItemStarted` / `ItemCompleted` 映射为此帧
- [ ] Web `AiChatPanel`：写操作渲染为行（`Write Action Line`，含失败态与错误码文案），读操作折叠；`step` 帧与四步进度表移除
- [ ] 观测性：新增 `codex-runtime` / `canvas-tool` 分类；`tool_call` span 记录 name、参数摘要、结果码、耗时；移除 `codex-runner` 分类并给 ADR-0006 追加勘误
- [ ] 测试：REVISION 冲突可见、撤销作用域（agent 顶 vs user 顶）、工具事件帧序、Web 行渲染与折叠
- [ ] `pnpm -r typecheck`、`pnpm -r test`、`pnpm -r build` 通过
- [ ] 手工验收：User Story 1（放大 + 投影改写同一图层）、User Story 6（执行中被用户改动时不静默覆盖）

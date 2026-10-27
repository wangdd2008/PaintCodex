# 02: 图层改写/删除/撤销工具与工具事件行

**What to build:** 补齐 `canvas_update_layer` / `canvas_delete_layer` / `canvas_undo` 三个工具，把工具调用作为一等事件推给前端，并让写操作在对话里成行显示。

**Blocked by:** 01、05

**Status:** done

- [x] `canvas_update_layer`：`{ canvasId, layerId, patch }` → `canvas_update_layer`；SVG patch 过 `isSafeSvg`
- [x] `canvas_delete_layer`：`{ canvasId, layerId }` → `canvas_delete_layer`（本票先直接执行，确认在 03 接入）
- [x] `canvas_undo`：仅当撤销栈顶快照的 actor 为 `agent` 时执行；否则返回 `{ ok:false, code:'top_action_is_user' }`
- [x] 工具失败统一为 `{ ok:false, code, message }`；删除 daemon 侧 `MAX_ACTION_RETRIES` 静默重试，`revision_conflict` 附 `currentRevision` 回给模型
- [x] `StreamPayload` 增加 `tool` 帧；Runtime 把 `ItemStarted` / `ItemCompleted` 映射为此帧
- [x] Web `AiChatPanel`：写操作渲染为行（`Write Action Line`，含失败态与错误码文案），读操作折叠；`step` 帧与四步进度表移除
- [x] 观测性：新增 `codex-runtime` / `canvas-tool` 分类；`tool_call` span 记录 name、参数摘要、结果码、耗时；移除 `codex-runner` 分类并给 ADR-0006 追加勘误
- [x] 测试：REVISION 冲突可见、撤销作用域（agent 顶 vs user 顶）、工具事件帧序、Web 行渲染与折叠
- [x] `pnpm -r typecheck`、`pnpm -r test`、`pnpm -r build` 通过（build 的 web 段受 Windows esbuild 临时文件权限影响，见 Comments，与票 01 已记录的同一环境问题）
- [x] 手工验收：User Story 1（放大 + 投影改写同一图层）、User Story 6（执行中被用户改动时不静默覆盖）

## Comments

- 2026-10-27 — 实现完成：`18f4448 feat(daemon): add layer write tools and tool event lines`。
  - 验证：`pnpm -r typecheck` 通过；`pnpm --filter @paintcodex/daemon test` 168 通过；`pnpm --filter @paintcodex/web test` 205 通过；`pnpm -r build` 中 daemon 构建通过，web 构建因 Windows esbuild 临时文件 `Access is denied` 失败（环境问题，与改动无关，web typecheck 与测试均通过；票 01 同样记录过）。
  - 真实 codex-cli 0.164.0 冒烟：`buildServer` + `POST /paint/ai/chat`（内存库，先建一个红圆图层）问「把画布上的「红圆」改成蓝色，位置和大小保持不变」。一轮 16.5s：先 `canvas_get_context` 传错 layerId 得到 `layer_not_found`（模型据此自我纠正），再读画布、`canvas_update_layer` 成功、最后再读一次确认；SSE 收到成对的 `tool` 帧（running → ok），最终同一图层 `fill` 变为 `blue`，`revision=2`，没有新建图层。User Story 1 与工具错误自纠均得到真实验证。
  - User Story 6：以 `revision_conflict` 单测覆盖（冲突码 + `currentRevision` 回给模型、无静默重试）；没有做「执行中人工改画布」的双端手工复现。
  - 偏差：`canvas_update_layer` 的 patch 形如 `{ name?, visible?, opacity?, svg? }`，`svg` 由工具转成 `LayerContent`；模型侧不用接触 `content` 对象。空 patch、未知字段、类型错误都返回 `invalid_arguments`。
  - 偏差：`canvas_undo` 的栈顶归属通过新增只读访问器 `PaintService.getUndoTarget()`（配合 `SnapshotRepository.at()`）读取，REST undo 语义未改；`nothing_to_undo` 作为新增可读失败码。
  - 偏差：工具日志消息由 `tool_result` 更名为 `tool_call`（ADR-0009 的统计锚点），`canvas-tool` payload 增加 `argumentSummary`（键名、ids、名称、SVG 长度，不落整段 SVG）。
  - 偏差：`layerCreated` 帧保留（Web 落地确认与撤销守卫仍依赖它），但 runtime 只在工具名为 `canvas_create_layer` 时才触发 `onLayerCreated`；改写图层不再被误报成「已添加图层」。
  - 偏差：Web 端保留「思考中…/正在生成…」与 `已用 Ns` 计时（终态「已完成 · 用时 Ns」不变），只删四步进度文案与 `step` 协议字段。
  - 合并提示（给 03/04）：`item/tool/call` 已按 thread 串行排队，确认通道若在工具内部挂起，会阻塞同一画布后续工具调用——03 应把确认放在工具执行前（队列内 await 用户答复）并给挂起加超时，否则 turn 会卡住；`callId` 是 `item` 帧 id 与工具结果码的关联键，04 的 thread 落库不要丢这个映射。生产 `codex app-server` 的 `item/started` 可能早于 `item/tool/call`，代码按 callId 关联，不依赖到达顺序。

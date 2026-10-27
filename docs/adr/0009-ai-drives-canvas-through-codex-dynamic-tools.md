# ADR-0009: AI 通过 Codex dynamic tools 驱动画布

## Status

Accepted — 2026-10-27. 部分修订 [ADR-0001](/docs/adr/0001-ai-generates-svg-only.md)（SVG 的产生方式）与 [ADR-0002](/docs/adr/0002-codex-cli-local-process.md)（子进程的交互方式）；两条 ADR 的结论本身仍然成立。

## Context

架构文档描述了「AI 通过 8 个工具、经 Command Dispatcher 操作画布，危险操作请求确认」，但实现从来不是这样：

- daemon 用一次性 `codex exec --json --ephemeral` 跑完一个子进程，AI 唯一的输出是一段文本，文本里夹着 `<<<CANVAS_ACTION>>>` 与一个 `{ name, svg }`；
- daemon 用正则把这坨 JSON 抠出来，硬编码成一条 `canvas_create_layer`；
- AI 拿不到图层 id、几何、选中区，也看不到自己那一步是否成功；一轮只能加一个图层，不能改、不能删、不能多步；
- 文档里的 `requiresApproval`、8 个工具、`codexAppServer.start()` 在代码里都不存在。

也就是说，「人机同权」只落实了一半：人类有完整的 `PaintAction`（create/update/delete + undo/redo），AI 只有「贴一张 SVG」的单一动作，而且还是由 daemon 代贴。这不是提示词写得好不好的问题——**AI 没有手**。

本机 `codex-cli 0.164.0` 提供了把这件事做对的原生能力（以下均由 `codex app-server generate-json-schema --experimental` 生成的协议 JSON 核实）：

- `ThreadStartParams.dynamicTools: DynamicToolSpec[]` —— 客户端在建 thread 时声明 `{ type:'function', name, description, inputSchema }` 工具；
- 模型调用时，客户端收到 `DynamicToolCall { callId, threadId, turnId, tool, arguments }` 请求，回 `{ success, contentItems:[{type:'inputText',text} | {type:'inputImage',imageUrl}] }`；
- `ToolRequestUserInput` 让工具向用户提问并取得回答（确认通道）；
- `ItemStarted/ItemCompleted` / `AgentMessageDelta` 提供逐条事件流；
- `ThreadStart/Resume/List/Delete` + `historyMode` 提供持久会话。

协议类型可由 CLI 的 `generate-ts` / `generate-json-schema` 生成，不必手抄。

## Decision

### 1. 画布以 dynamic tools 的形式暴露给模型

daemon 在 `startThread` 时声明固定的工具集（当前 7 个：`canvas_get_context`、`canvas_create_layer`、`canvas_update_layer`、`canvas_delete_layer`、`canvas_select`、`canvas_export_png`、`canvas_undo`，另预留 `canvas_render_preview`）。工具在 **daemon 进程内**执行，经 `CommandDispatcher` 落到既有的 `PaintAction`，`actor` 恒为 `agent`。

拒绝把画布能力做成 MCP server：那需要多一个进程、把工具结果跨进程序列化，并且确认、图片结果、会话记忆都要绕路实现一遍。dynamic tools 是同一件事的原生版本。

### 2. 传输改为长驻 `codex app-server`，不再是一次性 `exec`

一个 daemon 一个 app-server 子进程，一个画布一条 thread，一条用户消息一个 turn。代价是这套协议带 `[experimental]` 标签：daemon 启动时校验 `codex --version` 下限，CI 重新生成协议类型并比对，升级 CLI 必须跑通全链路测试。

### 3. 上下文改成「拉为主」

提示词只给画布标识、尺寸、revision、图层数。细节由 `canvas_get_context` 在执行中拉取——推送的快照从生成那刻起就会过期，且随图层数膨胀。

### 4. 失败对模型可见

工具失败返回 `{ ok:false, code, message }`，包括 `revision_conflict`（附当前 revision）。删掉 daemon 代 AI 静默重试的逻辑：一个看不见自己失败的执行器，不可能自纠。

### 5. 撤销只作用于 agent 自己的动作

`canvas_undo` 可以撤 agent 自己造成的上一步；若撤销栈顶是用户动作，返回 `{ ok:false, code:'top_action_is_user' }`，由 AI 转告用户。同权不等于代权——AI 对用户的手绘没有决定权。

### 6. 确认属于工具层

`canvas_delete_layer` 与 `canvas_export_png` 执行前通过 `ToolRequestUserInput` 阻塞询问用户，答复回传后才继续。不复用 Codex 自身的审批策略：审批策略管的是「让不让 Codex 动文件系统」，管不到「让不让 AI 删这张图层」。

### 7. 删除 marker 通路

`CANVAS_ACTION_MARKER`、`parseCanvasAction`、提示词里的 marker 指令及其测试在工具化落地时一并删除。`isSafeSvg` 保留，身份从「解析器守卫」改成「工具入参校验器」。

## Consequences

- **Positive**: AI 获得与人类同一集合的画布动作，多步任务（读 → 改 → 复核 → 再改）第一次成立。
- **Positive**: 工具调用、结果、错误都成为可观测事件，`tool_call` 成为 AI 行为统计的新锚点。
- **Positive**: 提示词不再随图层数量膨胀；上下文永远新鲜。
- **Negative**: 依赖一条标记为 experimental 的上游协议；升级 codex 可能打破 daemon，必须用版本闸门 + 生成类型 + 全链路测试来兜。
- **Negative**: 多步 turn 的时延高于单次生成，一次构图可能跑几秒到几十秒，前端必须给出逐条进度。
- **Negative**: 确认通道引入「工具调用挂起」状态，需要处理用户不答、离开页面、并发 turn 等边界。
- **Trade-off**: 用一条实验性协议换取「原生工具」，而不是用稳定的文本协议换取「永远只有一张 SVG」。前者会疼在升级时，后者会疼在每一次真实需求上。

## Alternatives Considered

| Alternative | Rejected Because |
|---|---|
| 保留 marker 协议，把 payload 扩成动作数组 | 仍是「文本语法 + daemon 代执行」：AI 拿不到结果、无法多步、失败不可见；只是把假工具做大 |
| `codex exec` + 注入 MCP server | 可行且更稳，但多一个子进程、结果跨进程序列化，确认要走 MCP elicitation、会话靠 `exec resume`；动态工具把这些都做成了原生 |
| 用 app-server 但把画布做成 Codex Skills | Skills 面向文件系统与仓库工作流，不提供「进程内回答工具调用」的通道，仍会退化成文本约定 |
| 换用自建 function-calling（直连模型 API） | 失去本地离线能力与 Codex 的会话/沙箱基建；ADR-0002 的本地优先结论仍然成立 |

## Migration Path

1. 新增 `Codex Runtime` 接缝（app-server 启停、thread、turn、事件映射、版本闸门、生成类型），旧 `CodexRunner` 保留至切片 1 合入。
2. 切片 1 同时接入 `canvas_get_context` / `canvas_create_layer` 并**删除 marker 通路**，保证「净替代、无回归」。
3. 切片 2 补 `canvas_update_layer` / `canvas_delete_layer` / `canvas_undo` 与工具事件行。
4. 切片 3 接确认通道；同时修正 `undo/redo/createCanvas/renameCanvas` 与 REST 删除里硬编码的 `actor:'user'`。
5. 切片 4 接 `canvas_render_preview` 与 thread 记忆的前端接线。
6. 按 `.scratch/codex-native-tools/` 的票据推进，ADR-0006 的 `codex-runner` 分类在切片 2 结束后由 `codex-runtime` / `canvas-tool` 取代。

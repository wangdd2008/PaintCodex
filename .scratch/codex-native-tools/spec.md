# Spec: Codex 原生工具（AI 从「对话」到「操作画布」）

## Problem Statement

当前 AI 只能对话，不能操作画布。它唯一的输出是一段文本，末尾夹着 `<<<CANVAS_ACTION>>>` 与一个 `{ name, svg }`，由 daemon 用正则抠出、硬编码成一条 `canvas_create_layer`。后果：

- **看不见画布**：提示词里只有图层名与类型，没有 id、几何、选中区，AI 无法指代任何已有图层；
- **只能新建**：`PaintAction` 的 update / delete 与 undo 从来不对 AI 开放；
- **看不见结果**：一轮结束即断线，AI 无从知道那一步是否成功，更谈不上自纠；
- **没有记忆**：`--ephemeral` 一次性进程，下一句话的 AI 不知道上一句画了什么；
- **失败不可见**：daemon 静默丢弃非法动作、静默重试 revision 冲突，AI 永远不知道自己在错。

架构文档曾描述「8 个工具 + 智能确认 + `codexAppServer.start()`」，但代码里一个都不存在。本 spec 把文档与实现重新对齐，并把「AI 具备系统操作能力」落成可验收的切片。

## Solution

把画布暴露成 Codex 的**原生 dynamic tools**，并用长驻的 `codex app-server` 承载 thread 与 turn。

- daemon 长驻一个 `codex app-server` 子进程，JSON-RPC 通信（`Codex Runtime` 是唯一接缝）；
- 建 thread 时声明工具集；模型在 turn 内可多次调用，工具结果回流给模型；
- 工具在 daemon 进程内执行，写类经 `CommandDispatcher` 落到既有 `PaintAction`，`actor` 恒为 `agent`；
- 删除 marker 协议与 daemon 的静默重试；
- 确认、撤销作用域、actor 归属按 [ADR-0009](../../docs/adr/0009-ai-drives-canvas-through-codex-dynamic-tools.md) 的六条决定执行。

## User Stories

1. 作为用户，我说「把红圆放大两倍并加投影」，AI 能先读画布、再改写那个图层的内容，而不是新建一个名字相似的图层。
2. 作为用户，我说「删掉刚才那个 AI 图层」，AI 会先问我，我点了确认它才删。
3. 作为用户，我说「刚才那笔撤掉」，若栈顶是我自己画的，AI 会告诉我需要我自己撤，而不是替我做主。
4. 作为用户，我在对话里能看到 AI 每一次**写画布**的动作成行出现，读操作折叠不吵我。
5. 作为用户，我连续两句说「再往右一点」，第二句的 AI 知道「那个」是哪个。
6. 作为用户，AI 执行期间画布被我自己动过时，AI 不会静默覆盖我的改动，而是重新读一遍再决定。
7. 作为开发者，我能在监控页看到每个工具调用的名称、结果码与耗时，并挂在同一条 trace 下。
8. 作为开发者，`codex` 版本过低时 daemon 启动就明确报错，而不是第一次对话才失败。

## Implementation Decisions

### Codex Runtime

- 新增 `apps/daemon/src/paint/agent/runtime/`：`codex-runtime.ts`（进程与 JSON-RPC）、`tools.ts`（工具声明与执行器）、`protocol.ts`（由 `codex app-server generate-ts` 生成）。
- 进程启停由 Runtime 负责：daemon 启动时拉起，崩溃自动重启一次，重启时重建内存中的 thread 映射。
- **版本闸门**：`codex --version` < 0.164 时 AI 路由不注册，`/health` 返回原因。
- 协议类型是从 `codex app-server generate-json-schema --experimental` 输出中精选转写的子集，不是 CI 生成物；本仓库没有 CI。升级 codex 时运行 `pnpm --filter @paintcodex/daemon codex:protocol-schema` 重新生成并与 `protocol.ts` 比对，再跑全链路测试。
- 保留 `CodexRunner` 接口直到切片 1 合入，之后删除。

### Thread 与 turn

- 一画布一 thread。切片 1 用内存 `Map<canvasId, threadId>`；切片 4 落库（`canvases.codexThreadId`，按 `database.ts` 既有的 `PRAGMA table_info` + `ALTER TABLE` 方式加列）并在 daemon 重启后 `resumeThread`。
- 一条用户消息一个 turn。turn 内的工具调用串行执行（单写者），避免并发覆盖 revision。
- 取消：SSE 断开 → `turn/interrupt`，thread 保留。

### 工具集（8 个）

| 工具 | 参数 | 执行 | 确认 |
|---|---|---|---|
| `canvas_get_context` | `{ canvasId, layerId? }` | 读 service | 否 |
| `canvas_create_layer` | `{ canvasId, name, svg, visible?, opacity?, expectedRevision? }` | `canvas_create_layer` | 否 |
| `canvas_update_layer` | `{ canvasId, layerId, patch, expectedRevision? }` | `canvas_update_layer` | 否 |
| `canvas_delete_layer` | `{ canvasId, layerId, expectedRevision? }` | `canvas_delete_layer` | 是 |
| `canvas_select` | `{ canvasId, layerId?, region? }` | UI 焦点，不落库 | 否 |
| `canvas_export_png` | `{ canvasId }` | 前端导出（ADR-0005） | 是 |
| `canvas_undo` | `{ canvasId }` | `undo` | 否，仅限 agent 自身动作 |
| `canvas_render_preview` | `{ canvasId }` | 返回渲染 PNG（`inputImage`） | 否 |

- 写类工具一律 `dispatcher.dispatch(canvasId, { actor: 'agent', expectedRevision, action })`；
- `expectedRevision` 是「模型上次观察到的 revision」：传了且不匹配就返回 `revision_conflict`（附 `currentRevision`），不传则维持旧行为（用刚读到的 revision）；所有成功写结果都带回新的 `revision`；
- SVG 入参过 `isSafeSvg`（由 marker 解析器转职而来）；
- 返回统一为 `{ ok: true, ... }` / `{ ok: false, code, message }`。

### 失败语义

| code | 触发 | 模型可读 |
|---|---|---|
| `revision_conflict` | `expectedRevision` 不匹配（附 `currentRevision`） | 是 |
| `top_action_is_user` | `canvas_undo` 栈顶是用户动作 | 是 |
| `nothing_to_undo` | 撤销栈已到最早快照（连快照都没有） | 是 |
| `user_declined` | 确认被拒、超时或通道不可用 | 是 |
| `invalid_arguments` | 参数类型/形状不合法 | 是 |
| `invalid_svg` | `isSafeSvg` 拒绝（附原因） | 是 |
| `layer_not_found` | layerId 不存在 | 是 |
| `canvas_not_found` | 画布不存在，或请求了非当前画布 | 是 |
| `canvas_required` | 当前对话没有画布 | 是 |
| `render_unavailable` | 无浏览器或渲染超时 | 是 |
| `export_unavailable` | 无浏览器或导出通道失败 | 是 |
| `export_busy` | 同一画布已有导出在等待 | 是 |
| `tool_timeout` | 工具执行超过 30s（人在等待的确认/渲染/导出不计入） | 是 |

daemon 不再替 AI 重试 revision 冲突（删除 `MAX_ACTION_RETRIES` 路径）。

### 协议与 SSE

`StreamPayload` 的一帧只携带下列字段之一：

| 帧 | 形状 | 消费方 |
|---|---|---|
| `delta` | `string` | 追加到气泡 |
| `tool` | `{ id, name, status: 'running' \| 'ok' \| 'failed', code? }` | 写操作成行显示，读操作折叠 |
| `confirm` | `{ id, title, detail, approveLabel? }` | 气泡内确认条；60s 无答复视为拒绝 |
| `layerCreated` | `{ id, name }` | 「图层已添加」提示 |
| `renderRequest` | `{ id, canvasId }` | 浏览器渲染并 `POST /paint/ai/render-result` |
| `exportRequest` | `{ id, canvasId }` | 浏览器下载并 `POST /paint/ai/export-result` |
| `select` | `{ canvasId, layerId? \| region?, clamped? }` | 移动 UI 焦点，无回执 |
| `notice` | `string` | 同一气泡里的一行状态（如「会话已重置」），turn 继续 |
| `done` | `true` | 结束 |
| `error` | `{ code, message }` | 终止并显示错误 |

`POST /paint/ai/confirm`：`{ requestId, approved, canvasId? }`，把答复送回挂起的工具调用。

### Web

- 写操作成行显示（`Write Action Line`），读操作折叠；
- `confirm` 帧渲染为气泡内的确认条，超时（60s）视为拒绝并说明；
- 移除对 marker 的剥离逻辑（不再有 marker）。

### 观测性

新增日志分类 `codex-runtime`、`canvas-tool`；`tool_call` 成为 AI 行为统计锚点。`codex-runner` 分类随旧 runner 在切片 2 结束时移除（ADR-0006 追加勘误）。

### 安全

- Codex 仍以 `-s read-only` 运行：AI 不需要 shell，也不需要写用户磁盘；
- 工具只能经 CommandDispatcher 改画布，无法访问文件系统与数据库；
- 确认只保护不可逆动作（删除、导出）；可撤销动作（新建、改写）直接执行。

## Out of Scope

- 像素级编辑（涂抹、局部重绘、inpaint）；
- 图像生成 API 接入（与 Q10 冲突）；
- AI 访问本地文件或执行命令；
- 多画布 / 多 agent 并发会话；
- 让 AI 自主撤销用户动作（明确拒绝，见 ADR-0009 第 5 条）。

## Slices

| 切片 | 内容 | 票 |
|---|---|---|
| 1 | Runtime + get_context + create_layer + 删除 marker | 01 |
| 2 | update / delete / undo + 工具事件行 | 02 |
| 3 | 确认通道 + actor 归属 | 03、05 |
| 4 | render_preview（已落地，含图片结果）+ thread 落库与恢复 | 04 |
| 5 | 导出工具 + 确认（依赖 03、04 的通道） | 06 |

独立缺陷：`05-actor-attribution.md`（今天的 undo/redo 归属就是错的，与切片并行修）。

## Acceptance

- `pnpm -r typecheck` / `pnpm -r test` / `pnpm -r build` 全绿（build 的 web 段在 Windows 需按 README「Checks」里的 TEMP 规避法执行）；
- 全链路手工验收用真实 `codex` 跑通 User Story 1、2、4、6；
- daemon 在 `codex` 版本过低时拒绝启动 AI 路由，错误信息可操作；
- 全仓 grep 不到 `CANVAS_ACTION_MARKER`（切片 1 之后）。

### 验收记录

- 2026-10-28，真实 `codex-cli 0.164.0` + 构建后的 daemon（临时库，`PORT=3299`），SSE 逐帧核对：
  - US1「把刚才那个圆改颜色」：`canvas_get_context` → `canvas_update_layer`，图层数 1→1（就地改写，未叠新层），revision 1→2，颜色由红改蓝；两次工具调用都成对出现 `running`/`ok` 帧。
  - US2「把这个圆删掉」：先收到 `confirm`「删除图层「红色圆形」」，经 `POST /paint/ai/confirm` 批准后才执行 `canvas_delete_layer`，图层数 1→0，revision 3。
  - US5（跨重启指代）与「resume 后工具仍可用」由票 04 的独立探针验证（见该票 Comments）。
  - US6（并发编辑下的修订冲突）只有单元测试覆盖，未做双人实时手工复现——记录在此，避免被读成「已人工验证」。

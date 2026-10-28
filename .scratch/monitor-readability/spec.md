# 监控可读性：方向、追踪与会话流

> 现在监控页是「139 行一模一样的 `http_request`」。看不清的不是数据不够，而是**消息没有方向、明细没有渲染、追踪缺了最关键的一跳**。本轮让日志能回答「谁跟谁说了什么」。

## Problem Statement

四个机制性原因，全部有代码依据：

1. **`payload` 从来没被渲染过。** 监控前端全仓没有 `.payload` 引用。`http_request` 的 method / path / statusCode 全在 payload 里（`server.ts:133-156`），工具调用的 `tool` / `ok` / `argumentSummary` 也在 payload 里（`tools.ts:325-341`）。所以 139 行的消息文本完全相同，只有 8 位 trace id 不同。
2. **没有方向概念。** 日志只有 `category`（`http` / `sse` / `codex-runtime` / `canvas-tool` / `ai-chat` / `canvas-action` / `system`），没有 source / target。`http` 既可能是请求也可能是响应，`codex-runtime` 里两个方向混在一起，UI 无从表达「浏览器 → Daemon」。
3. **追踪是断的。** `canvas-action`（`service.ts:374-378`）与 `sse`（`routes.events.ts:33-67`）不带 `traceId`，这些行点不开；更糟的是 **AI 工具改画布的那一跳不在对话追踪里**——追踪恰好缺了结论。
4. **列表单位错了。** 一行一条记录，于是「一次请求」被拆成开始/结束两条，「一次对话」被拆成十几条散落各处。完成记录的时间戳是**开始时间**（`logger.ts:168` 回溯写入），列表又按 `timestamp DESC`，造成「排在前面、来得最晚」。

此外，页面从未有过架构视图，用户不知道 `codex-runtime` / `canvas-tool` 这些分类对应系统里的什么部件。

## Solution

四层，逐层建立：

- **消息有方向**：日志加 `source` / `target`，组件词表固定为 `browser | daemon | codex | model | sqlite`。
- **追踪变完整**：`traceId` 贯通到画布落库与 SSE 推送。
- **列表按追踪聚合**：一行一个 trace，展开看往来；保留「原始日志」开关。
- **两张图**：追踪内部（时序图 + 层级树切换）、页面级（静态拓扑 + 实时叠加）。

## User Stories

1. 作为排障者，我想一眼看出「哪个组件发给了哪个组件」，而不是从 category 猜。
2. 作为排障者，我想让日志列表按追踪聚合，一行就是一次请求或一次对话。
3. 作为排障者，我想在一个追踪里看到「用户提问 → 模型调用工具 → 画布被改 → 推送给浏览器」的完整往来。
4. 作为排障者，我想点开任意一条记录看到 method / path / status / tool / ok 这些明细，而不是一个 `http_request` 字符串。
5. 作为排障者，我想看某个追踪内部的时序（谁先跟谁说话），也想切回层级（谁嵌在谁里面）。
6. 作为新加入的人，我想看一张架构图，知道 `daemon`、`codex`、`sqlite` 分别是什么、谁和谁有往来。
7. 作为排障者，我想点架构图上的节点或连线，把日志过滤到那条通道。
8. 作为排障者，我想让列表按落库顺序排列，后发生的在后，不要出现「完成记录排在开始记录前面」。

## Scope

| # | 主题 | 票 |
|---|---|---|
| 1 | 日志方向模型 `source`/`target` + 组件词表 + 旧数据回填 | 01 |
| 2 | 追踪补全：`canvas-action` / `sse` 带上 trace | 02 |
| 3 | 追踪摘要接口 `GET /monitor/traces` | 03 |
| 4 | 按追踪聚合的列表 + payload 明细 + 排序修正 | 04 |
| 5 | 追踪内部：时序图 / 层级树切换 | 05 |
| 6 | 拓扑图：静态 SVG + 实时叠加 + 点击过滤 | 06 |

## Implementation Decisions

### 1. 方向是日志的字段，不是前端推导

```sql
ALTER TABLE agent_logs ADD COLUMN source TEXT;
ALTER TABLE agent_logs ADD COLUMN target TEXT;
```

`LogComponent = 'browser' | 'daemon' | 'codex' | 'model' | 'sqlite'`。

- **只有「消息型」记录填方向**；span 的开始/结束记录里，只有同时也是一次往来的才有方向；纯内部事件（`system` 启动、`db_migrated`）保持 NULL。
- 无方向 ≠ 未知：UI 显示「内部」而不是「未标注」，因为它本来就不过网络。
- 词表放进 `packages/protocol`，前端画图、后端校验共用同一份。

方向映射表（实现以此为准）：

| 事件 | message | source → target |
|---|---|---|
| HTTP 请求开始 | `http_request`（起始记录） | `browser → daemon` |
| HTTP 响应结束 | `http_request`（结束记录） | `daemon → browser` |
| SSE 订阅 | `sse_subscribe` | `browser → daemon` |
| SSE 推送 | `sse_publish` | `daemon → browser` |
| SSE 断开 | `sse_disconnect` | `browser → daemon` |
| turn 发起 | `turn_start` | `daemon → codex` |
| turn 完成 | `turn_complete` | `codex → daemon` |
| thread 建立/恢复 | `thread_start` / `thread_resume` | `daemon → codex` |
| 工具调用 | `tool_call`（`canvas-tool`） | `codex → daemon` |
| 画布落库 | `layer_create` / `layer_update` / `layer_delete` / `undo` / `redo` / `canvas_create` / `canvas_rename` | `daemon → sqlite` |
| 内部 | `system`、运行时进程错误等 | NULL |

「模型」节点**没有任何直接日志**——daemon 看不见 codex 与模型之间的流量。它在拓扑里存在，并且只由 codex 一侧标注为「间接观测」。

### 2. 旧数据只回填能安全推导的部分

迁移里**只**执行两条：

```sql
UPDATE agent_logs SET source = 'browser', target = 'daemon'
  WHERE category = 'http' AND source IS NULL;
UPDATE agent_logs SET source = 'daemon', target = 'browser'
  WHERE category = 'sse' AND source IS NULL;
```

其余保持 NULL。理由：`codex-runtime` 分类里请求与响应混在一起，单凭 category 推方向会**猜错**，而错误的箭头比没有箭头更坏。

### 3. 追踪补全

- `CommandDispatcher` / `PaintService` 接受可选的 `trace?: TraceContext`。
- AI 工具路径传 `turn span`；REST 路径传 HTTP span；`ObservabilityEvents.publish` 带上触发它的那个 trace，让 `sse_publish` 归入同一追踪。
- 结果：一次 AI 对话的追踪里出现 `ai_chat → codex_turn → tool_call → layer_update → sse_publish` 这条完整链。

### 4. 追踪摘要接口

```http
GET /monitor/traces?windowMs=900000&limit=50&offset=0&canvasId=&hasError=
200 → {
  items: [{
    traceId, startedAt, endedAt,
    spanCount, errorCount,
    components: LogComponent[],     // 去重，按首次出现排序
    rootMessage,                    // 根 span 的 message
    requestPath: string | null,     // 根 http span 的 payload.path
    canvasId: string | null,
    actor: 'user' | 'agent' | null
  }],
  total, windowMs
}
```

- `windowMs` 1–86_400_000，默认 900_000（15 分钟）。**必须带窗口**：`GROUP BY trace_id` 全表扫描会随 `agent_logs` 无界增长而变慢。
- `durationMs = max(timestamp + COALESCE(duration_ms, 0)) - min(timestamp)`，`spanCount = COUNT(*)`，`errorCount = SUM(level = 'error')`。
- 排序：`startedAt DESC`。

### 5. 列表按追踪聚合

- 默认视图：一行一个 trace。列＝开始时间 / 根消息 / 组件路径（`浏览器 → Daemon → Codex`）/ 节点数 / 错误数 / 总耗时。
- 点击展开：就在列表内展示该 trace 的时序（票 05 的组件），不跳页。
- 「原始日志」开关切回逐条视图；逐条视图按 **`id DESC`（落库顺序）** 排序，时间列显示开始时间，另有「耗时」列——这样不会出现「完成记录排在开始记录上面」。
- 没有 `traceId` 的记录进单独的「未归组」分段（数量少，且大多是 `system`）。

### 6. payload 明细渲染

一个 `LogDetail` 组件，按已知键渲染成「标签：值」：

| 键 | 标签 | 出现处 |
|---|---|---|
| `method` / `path` / `statusCode` | 方法 / 路径 / 状态码 | http |
| `tool` / `ok` / `argumentSummary` / `layerId` / `code` | 工具 / 结果 / 参数摘要 / 图层 / 错误码 | canvas-tool |
| `deltaCount` / `outputLength` / `assistantLength` / `toolCallCount` | 增量数 / 输出长度 / 回复长度 / 工具调用数 | ai-chat |
| `promptLength` / `layerCount` / `hasCanvas` | 提示长度 / 图层数 / 有无画布 | ai-chat |
| `revision` / `event` | 修订号 / 事件 | sse / canvas-action |

未知键回落为可折叠的原始 JSON，超过 2000 字符截断并标注「已截断」。payload 本身在库里不截断，截断只发生在渲染层。

### 7. 追踪内部：时序图为默认，层级树可切

- **时序图**：横轴是本次追踪涉及的组件（按 `components` 定列），纵轴是时间；每条有方向的记录画成一根从 source 指向 target 的箭头，箭头旁写 message，箭头长度按 `durationMs`（无耗时的画成圆点）。
- **层级树**：保留现有父子结构（`parentId` → `spanId`），每行恒加方向列。
- 顶部一个二选一开关，同一份 `GET /monitor/traces/:traceId` 数据，两种布局。
- 点击任意节点 → 下方 payload 明细。

### 8. 拓扑图

手写 SVG，5 个节点固定坐标，不引入图表库（ADR-0006 的「零新增运行时依赖」）：

```text
浏览器 ⇄ Daemon ⇄ Codex ⇄ 模型(间接)
              ⇅
           SQLite(间接)
```

- 实线 = 可观测通道；虚线 = 间接观测（模型、SQLite 的读路径）。
- 每个节点/边叠加近 5 分钟的数字：消息数、错误数。
- **平均耗时排除长连接**：`durationMs > 10_000` 的记录不计入平均，UI 上标注「不含长连接」——否则 SSE 流会把 `daemon → browser` 的平均拉到几分钟。

```http
GET /monitor/topology?windowMs=300000
200 → {
  windowMs,
  nodes: [{ id: LogComponent, count, errorCount }],
  edges: [{ source, target, count, errorCount, avgDurationMs: number | null }]
}
```

- 点击节点或边 → 在追踪列表上加一个过滤 chip（按组件/按边），再点一次取消。
- 拓扑是**静态声明**，不因某个组件这五分钟没有流量就消失。

## Testing Decisions

- 方向：每条映射一行测试（传入真实 payload，断言 `source`/`target`）；迁移测试断言只回填 http/sse，其余为 NULL。
- 追踪补全：一次工具调用后，`/monitor/traces/:id` 里能查到 `layer_update` 与 `sse_publish`。
- 摘要接口：窗口过滤、`spanCount`/`errorCount`/`durationMs` 与逐条查询一致；空窗口返回空数组而不是 400。
- 前端：时序图的分列与排序是纯函数（`buildSequence(trace)`），单测；拓扑 SVG 只测「节点/边数量与点击回调」。
- 视觉验收手动：`?page=monitor` 在 1440×900 与 390×844 下各看一次。

## Out of Scope

- 日志保留策略 / 自动清理（ADR-0006 已推迟；本条仍推迟，但摘要接口必须带窗口，避免被无界增长拖死）。
- 全文搜索、虚拟滚动、分页跳页、告警。
- 分布式追踪（跨进程 `traceparent` 传播）。
- 把 prompt / assistant 文本写进日志（隐私边界不变，见 `agent-observability/spec.md:136` 的勘误）。
- 图表库（d3 / react-flow / mermaid）。

## Superseded Decisions

| 原决定 | 出处 | 本轮改为 |
|---|---|---|
| 日志只有 `category`，没有方向 | ADR-0006 schema | 增加 `source`/`target` |
| `canvas-action` / `sse` 不参与追踪 | 当前实现 | 贯通 trace |
| 列表按 `timestamp DESC` | `repository.ts:112` | 逐条视图按 `id DESC`；追踪视图按 `startedAt DESC` |
| 追踪视图只有层级树 | `TraceView.tsx` | 时序图为默认，树可切 |
| 监控无架构视图 | 无 | 静态拓扑 + 实时叠加 |

## Further Notes

- 术语已写入 `GLOSSARY.md`：追踪 / 消息 / 方向 / 组件 / 拓扑。
- `category` 与 `component` 不是一回事：category 是日志的归类，component 是消息的端点。同一个 `http` 分类里，请求记录是 `browser → daemon`，响应记录是 `daemon → browser`。
- 现有统计口径的修复（错误率、小样本成功率、取消不算失败）已经落地（commit `070b925`），本轮**不要**重做。

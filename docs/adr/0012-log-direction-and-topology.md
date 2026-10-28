# ADR-0012: 监控引入消息方向与静态拓扑

## Status

Accepted — 2026-10-29. Extends ADR-0006 (schema and page) without changing its storage or transport decisions.

## Context

ADR-0006 的监控页在「有数据」这一层是成功的：每条日志都有 trace/span、SSE 实时推送、统计卡片。失败的是「读得懂」这一层：

- 139 行日志的消息文本全是 `http_request`，区分它们的 method / path / statusCode 躺在 `payload` 里，而前端从不渲染 `payload`。
- 日志只有 `category`。`http` 分类里既有请求也有响应，`codex-runtime` 分类里两个方向混在一起——**没有字段能表达「谁发给了谁」**。
- 追踪是断的：`canvas-action` 与 `sse` 不带 `traceId`，所以一次 AI 对话的追踪里看不到「画布真的被改了」和「结果推给了浏览器」这两跳。

这三件事不能靠前端补救：方向不是能从 `category` 可靠推导的属性（`codex-runtime` 就是反例），缺失的 trace 也不会因为 UI 改版而出现。

## Decision

### 1. 方向是日志的一等字段

`agent_logs` 增加 `source` / `target`（nullable），取值来自固定词表 `browser | daemon | codex | model | sqlite`。只有消息型记录填；内部事件保持 NULL，UI 显示「内部」而不是「未标注」——它本来就不经过任何通道。

### 2. 旧数据只回填能证明的部分

迁移只填 `http`（`browser → daemon`）与 `sse`（`daemon → browser`）。其余留空：`codex-runtime` 里请求与响应同分类，单凭 category 推方向会猜错，而**错误的箭头比没有箭头更坏**。

### 3. 追踪要补全，而不是换一种展示

把 trace context 传进 `CommandDispatcher` / `PaintService` 与 SSE 发布。这是本 ADR 里唯一一处改动热路径的决定——它让「agent 改了哪一层」出现在对话追踪里。没有它，时序图再漂亮也缺结论。

### 4. 列表单位从「记录」改成「追踪」

服务端提供 `GET /monitor/traces` 摘要（聚合、窗口过滤），客户端一行一个 trace。逐条视图保留为开关，按 `id DESC` 排序。

### 5. 拓扑静态声明，数据叠加其上

节点与边写死在代码里（5 节点、固定坐标、手写 SVG），实时数字叠加。**不**由观测数据动态生成节点/边。

理由：图的作用是「让人看懂系统长什么样」，静态拓扑保证它永远正确、永远可读；动态图在冷启动时是空的，恰好废掉它存在的理由。

不引入 d3 / react-flow / mermaid：节点与边固定，不需要布局引擎（ADR-0006 的「零新增运行时依赖」）。

## Consequences

- **Positive**: 日志第一次能回答「谁跟谁说了什么」。
- **Positive**: 一次 AI 对话的追踪包含完整链路：`ai_chat → codex_turn → tool_call → layer_update → sse_publish`。
- **Positive**: 新成员可以靠一张图理解 `daemon` / `codex` / `sqlite` 的关系。
- **Negative**: 每条日志多两列，写入略增；列表页要多渲染一层聚合。
- **Negative**: 追踪摘要必须带时间窗口，否则 `GROUP BY trace_id` 会随无界增长变慢。**日志保留策略仍未实现**（ADR-0006 已推迟），这条 ADR 只是让界面不被它拖死。
- **Trade-off**: 用两个 nullable 列换掉「前端从 category 猜方向」。代价是旧数据不完全；换来的是不撒谎。

## Alternatives Considered

| Alternative | Rejected Because |
|---|---|
| 前端从 `category` + `payload` 推导方向 | `codex-runtime` 同时含请求与响应，推导会猜错 |
| 把方向做成独立的 `messages` 表 | 日志量下是多一次 join；方向本来就是记录的一个属性 |
| 全动态拓扑（节点/边来自观测） | 冷启动是空图，无法回答「系统长什么样」 |
| 引入 react-flow 画拓扑 | 节点固定，布局引擎是纯成本 |
| 只给 HTTP/SSE 加方向 | 恰好漏掉最有价值的那条边（codex ⇄ daemon） |

## Migration Path

1. `ALTER TABLE agent_logs ADD COLUMN source/target`；两条回填 `UPDATE`。
2. `logger` / `span.log()` 的入参加可选 `source`/`target`；各埋点按映射表填。
3. `PaintService` 与 `ObservabilityEvents.publish` 接受可选 trace context。
4. 新增 `GET /monitor/traces` 与 `GET /monitor/topology`。
5. 前端：追踪列表、payload 明细、时序图/树切换、拓扑 SVG。

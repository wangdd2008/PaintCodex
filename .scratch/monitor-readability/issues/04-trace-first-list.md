# 04: 按追踪聚合的日志列表 + payload 明细

**What to build:** 监控页默认一行一个追踪；逐条视图保留；每条记录都能看到 payload 里的人读字段。

**Blocked by:** 03

**Status:** done

**Covers:** 监控 §5、§6

**Size:** L

## Acceptance Criteria

- [x] 默认视图是追踪列表：列＝开始时间 / 根消息 / 组件路径 / 节点数 / 错误数 / 总耗时；一行一个 trace。
- [x] 组件路径渲染成 `浏览器 → Daemon → Codex` 形式，来自 `components`。
- [x] 点击一行展开该追踪的时序（票 05 的组件），在同一页内，不跳转。
- [x] 「原始日志」开关切回逐条视图；逐条视图按 `id DESC` 排序（落库顺序），时间列显示开始时间，另有耗时列。
- [x] 没有 `traceId` 的记录进「未归组」分段，不再渲染成不可点的死行。
- [x] `LogDetail` 组件按已知键渲染：`method`/`path`/`statusCode`、`tool`/`ok`/`argumentSummary`/`layerId`/`code`、`deltaCount`/`outputLength`/`assistantLength`/`toolCallCount`、`promptLength`/`layerCount`/`hasCanvas`、`revision`/`event`。
- [x] 未知键回落为可折叠原始 JSON，超 2000 字符截断并标注「已截断」。
- [x] 方向列：有 source/target 显示 `源 → 目标`；NULL 显示「内部」。
- [x] 「加载中 / 空 / 错误」三态都有明确文案；错误态可重试。
- [x] 时间为空或非法的记录不崩，显示 `—`。

## Notes

- 逐条视图的 `id DESC` 要改服务端 `AgentLogRepository.query` 的 `ORDER BY`（现在是 `timestamp DESC, id DESC`）；只改前端排序没有用，`limit` 会先截掉旧记录。
- 聚合必须在服务端（票 03）；客户端只缓冲 200 条，凑不齐一个 trace。
- payload 在库里不截断，截断只发生在渲染层。
- 已有统计卡片的修复（错误率口径、小样本、取消）不要重做。


## Comments

- 2026-10-29 · 实现完成：`e46269b`，合入 integration 分支 `feat/canvas-library-workspace-monitor`（merge `3e3d056`）；经 code-review 双轴复查与统一修复（`4475df8`/`bdcc10a`）后验收全部满足，关闭。

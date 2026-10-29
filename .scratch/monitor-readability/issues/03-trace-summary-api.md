# 03: 追踪摘要接口 `GET /monitor/traces`

**What to build:** 服务端按 trace 聚合的列表，带时间窗口与分页，供「一行一个追踪」的视图使用。

**Blocked by:** 01

**Status:** done

**Covers:** 监控 §4

**Size:** M

## Acceptance Criteria

- [x] `GET /monitor/traces?windowMs=&limit=&offset=&canvasId=&hasError=` 返回 `{ items, total, windowMs }`。
- [x] `TraceSummary` 字段：`traceId`、`startedAt`、`endedAt`、`spanCount`、`errorCount`、`components`（去重、按首次出现排序）、`rootMessage`、`requestPath`、`canvasId`、`actor`。
- [x] `windowMs` 默认 900000，范围 1–86_400_000；`limit` 1–100（默认 50）。
- [x] `startedAt = MIN(timestamp)`；`endedAt = MAX(timestamp + COALESCE(duration_ms, 0))`；`errorCount = SUM(level = 'error')`。
- [x] 排序 `startedAt DESC`；`total` 为窗口内 trace 总数。
- [x] `hasError=true` 只返回 `errorCount > 0` 的追踪。
- [x] `canvasId` 过滤可用（用于从画布页下钻，预留给后续）。
- [x] 空窗口返回 `items: []`、`200`，不是 400。
- [x] 查询走 `(trace_id, timestamp)` 索引，并在测试里对 10 万行数据做一次耗时基线（< 300ms）。
- [x] 与 `GET /monitor/traces/:traceId` 的数据一致：同一 trace 的 `spanCount` 等于详情里的节点数。

## Notes

- 必须带窗口过滤，否则 `GROUP BY trace_id` 全表扫描会随无界增长变慢（ADR-0012 的已知代价）。
- `requestPath` 取根 http span 的 `payload.path`；没有则 `null`。


## Comments

- 2026-10-29 · 实现完成：`021757e`，合入 integration 分支 `feat/canvas-library-workspace-monitor`（merge `3446305`）；经 code-review 双轴复查与统一修复（`4475df8`/`bdcc10a`）后验收全部满足，关闭。

# 03: 监控口径

**What to build:** 让监控页的每个数字都能从自己的标签复算出来——错误率只统计 HTTP 且标注分子分母，全部错误单列，分母为 0 显示 `—`，成功率剔除主动取消并对小样本显示 `—`，统计聚合排除监控页自身的请求。

**Blocked by:** None (can start immediately)

**Status:** done

**Covers:** UX-03, UX-16

**Size:** S

## Acceptance Criteria

- [x] 卡片更名「HTTP 错误率」，hint 形如 `0 失败 · 2 冲突 / 24 请求`；分子与分母都能从 hint 直接读到。
- [x] 另起一处「全部错误」：`1 · ai-chat 1`，数值与分类条中的错误计数一致。
- [x] 无 HTTP 请求时分母为 0，卡片显示 `—`，不显示 `0.0%`。
- [x] 成功率分母剔除 `aborted:true` 的记录；「取消」单独计数并展示。
- [x] 成功次数 `n < 5` 时成功率显示 `—`，hint 仍显示 `1/1 次对话 · 1 取消`。
- [x] 统计聚合排除 `/monitor/*` 请求；日志仍保留这些请求（监控不观测自己，但不隐藏证据）。
- [x] 4xx（`warn`）仍计入失败，但在 hint 中与 `error` 分开呈现。
- [x] 自动化（repository 单测）：1 成功 + 1 取消 → 成功率 `—`、hint 显示 1 取消；5 成功 → `100.0%`；0 请求 → `—`；`/monitor/stats` 自身轮询不进入 `requestCount`。

## Notes

- 现状两个成因必须同时修：`errorCount` 统计全部分类而 `errorRate` 只算 HTTP；`requestCount` 还把监控自轮询算进去（只有 `/monitor/events` 被排除）。
- 报告 §4 UX-16 的验收「1 成功 + 1 取消 → 100.0%（1/1）」已被本轮口径取代，见 spec `## Further Notes`。

## Comments

2026-10-26 — 实现完成，随后合并 `feat/release-hardening` 的最新提交。

- 实现提交：`070b925`。
- 验证：`pnpm --filter @paintcodex/daemon test`（103 → 111 passed）、`pnpm --filter @paintcodex/web test`（63 → 74 passed；合并 06 的图层测试后总计 79）、`pnpm -r typecheck` 全绿。
- 口径：
  - **HTTP 错误率** = (5xx `error` + 4xx `warn`) / 排除 `/monitor/*` 后的 HTTP 请求数；hint 固定写 `N 失败 · M 冲突 / K 请求`，分子分母可直接复算；`K = 0` 时比率为 `null`，界面显示 `—`。
  - **全部错误** = 窗口内所有分类 `level='error'` 的条数；hint 按分类列出 `category N`，与分类条的错误计数同源；4xx 只作为「冲突」进入错误率分子，不进入「全部错误」。
  - **AI 成功率** = 非 `aborted` 且 `level='info'` 的 `chat_completed` / 非 `aborted` 的 `chat_completed`；`aborted:true` 单列「取消」且不进分母；分母 < 5 时比率为 `null`，界面显示 `—`，hint 仍写 `成功/次数 次对话 · N 取消`。
  - **统计聚合**排除 `payload.path` 以 `/monitor/` 开头的 HTTP 记录（`totalLogs`、分类计数、`requestCount`、平均耗时、错误计数一并排除）；`/monitor/logs` 与 trace 查询仍保留这些记录；`/monitor/events` 仍不写日志，避免 SSE 自反馈。
- 测试落点：`apps/daemon/test/observability-repository.test.ts`（统计口径）、`apps/daemon/test/monitor-api.test.ts`（自轮询排除 + 证据保留）、`apps/web/test/monitor-format.test.ts`（hint 文案）、`apps/web/test/stats-panel.test.tsx`（卡片与 `—` 呈现）。

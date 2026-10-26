# 03: 监控口径

**What to build:** 让监控页的每个数字都能从自己的标签复算出来——错误率只统计 HTTP 且标注分子分母，全部错误单列，分母为 0 显示 `—`，成功率剔除主动取消并对小样本显示 `—`，统计聚合排除监控页自身的请求。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

**Covers:** UX-03, UX-16

**Size:** S

## Acceptance Criteria

- [ ] 卡片更名「HTTP 错误率」，hint 形如 `0 失败 · 2 冲突 / 24 请求`；分子与分母都能从 hint 直接读到。
- [ ] 另起一处「全部错误」：`1 · ai-chat 1`，数值与分类条中的错误计数一致。
- [ ] 无 HTTP 请求时分母为 0，卡片显示 `—`，不显示 `0.0%`。
- [ ] 成功率分母剔除 `aborted:true` 的记录；「取消」单独计数并展示。
- [ ] 成功次数 `n < 5` 时成功率显示 `—`，hint 仍显示 `1/1 次对话 · 1 取消`。
- [ ] 统计聚合排除 `/monitor/*` 请求；日志仍保留这些请求（监控不观测自己，但不隐藏证据）。
- [ ] 4xx（`warn`）仍计入失败，但在 hint 中与 `error` 分开呈现。
- [ ] 自动化（repository 单测）：1 成功 + 1 取消 → 成功率 `—`、hint 显示 1 取消；5 成功 → `100.0%`；0 请求 → `—`；`/monitor/stats` 自身轮询不进入 `requestCount`。

## Notes

- 现状两个成因必须同时修：`errorCount` 统计全部分类而 `errorRate` 只算 HTTP；`requestCount` 还把监控自轮询算进去（只有 `/monitor/events` 被排除）。
- 报告 §4 UX-16 的验收「1 成功 + 1 取消 → 100.0%（1/1）」已被本轮口径取代，见 spec `## Further Notes`。

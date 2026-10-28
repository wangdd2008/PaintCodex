# 06: 拓扑图：静态 SVG + 实时叠加 + 点击过滤

**What to build:** 手写 SVG 画出 5 个组件与它们之间的通道，叠加近 5 分钟的数据，点击节点/边过滤日志。

**Blocked by:** 01, 03

**Status:** ready-for-agent

**Covers:** 监控 §8

**Size:** L

## Acceptance Criteria

- [ ] 5 个节点固定坐标：浏览器 / Daemon / Codex / 模型（间接）/ SQLite（间接）；实线为可观测通道，虚线为间接观测。
- [ ] `GET /monitor/topology?windowMs=300000` 返回 `{ windowMs, nodes, edges }`：`nodes: {id,count,errorCount}[]`、`edges: {source,target,count,errorCount,avgDurationMs}[]`。
- [ ] 平均耗时排除 `durationMs > 10_000` 的记录，并在 UI 上标注「不含长连接」。
- [ ] 节点/边显示近 5 分钟的消息数与错误数；错误数 > 0 时有明显视觉区分（不是只靠颜色）。
- [ ] 某个组件/边在窗口内没有流量时，图**不变形**——节点和边照常显示，数字为 0。
- [ ] 点击节点 → 在追踪列表上加「组件」过滤 chip；点击边 → 加「通道」过滤 chip；再点一次取消；同一时刻只有一个 chip。
- [ ] chip 存在时，追踪列表与原始日志都按它过滤。
- [ ] 图有可读的 `aria-label` 与节点文字（不是纯装饰），键盘可遍历节点。
- [ ] 1440×900 与 390×844 下都不遮挡统计卡片与列表；窄屏横向可滚动。
- [ ] 零新增依赖：`apps/web/package.json` 不变。

## Notes

- 拓扑是**代码里的静态声明**，节点与边写死；数据只叠加在既有结构上（ADR-0012）。
- `model` 节点没有直接日志，它的数字来自 codex 侧；若无法归因，显示「—」而不是 0。
- 与统计卡片并排或在其下方，不做独立标签页。

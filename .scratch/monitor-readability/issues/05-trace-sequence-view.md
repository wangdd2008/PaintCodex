# 05: 追踪内部：时序图 / 层级树切换

**What to build:** 追踪详情默认显示泳道时序图（谁先跟谁说话），可切回层级树（谁嵌在谁里面）。

**Blocked by:** 01, 02, 03

**Status:** done

**Covers:** 监控 §7

**Size:** L

## Acceptance Criteria

- [x] 顶部二选一开关：时序图（默认）/ 层级树；同一份 `GET /monitor/traces/:traceId` 数据，两种布局。
- [x] 时序图：横轴是本次追踪涉及的组件（顺序取 `components`），纵轴是时间；每条有方向的记录画成 source→target 的箭头，箭头旁写 message。
- [x] 无方向的记录（内部事件）在时序图里渲染为对应组件列上的圆点。
- [x] 有 `durationMs` 的箭头长度按耗时绘制；无耗时的画成点。
- [x] 点击任意节点/箭头 → 下方显示 `LogDetail`（票 04 的组件）。
- [x] 层级树保留父子结构，每行恒有方向列（`源 → 目标` 或「内部」）。
- [x] 时间轴按 `timestamp` 升序；跨度过大时显示相对时间（`+123ms`）。
- [x] 空追踪、加载中、错误三态有文案；刷新按钮保留。
- [x] 布局计算抽成纯函数 `buildSequence(trace)`，单测覆盖：分列顺序、排序、无方向记录、缺失方向端点。

## Notes

- 手写 SVG/DOM，不引入图表库（ADR-0012）。
- 组件很多时横向可滚动，不压缩字号。
- 移动端（≤640px）时序图允许横向滚动，不重排。


## Comments

- 2026-10-29 · 实现完成：`6935ed0`，合入 integration 分支 `feat/canvas-library-workspace-monitor`（merge `9cee88e`）；经 code-review 双轴复查与统一修复（`4475df8`/`bdcc10a`）后验收全部满足，关闭。

# Handoff: 画布库 / 布局缩放 / 监控可读性 — 设计完成，待实现

> Generated: 2026-10-29
> Session focus: `/grill-with-docs` — 把用户提的五项改进 grill 成三份 spec、17 张票、3 份 ADR

## Current state

- `main` 在 `2583dda`，**本会话没有提交**。
- **零代码改动**：`apps/daemon`、`apps/web`、`packages/protocol` 全部未动。
- 工作区改动只有文档：
  - `M GLOSSARY.md`（新增 9 条术语）
  - 新增 `.scratch/canvas-library/`、`.scratch/workspace-layout-and-zoom/`、`.scratch/monitor-readability/`
  - 新增 `docs/adr/0010-*`、`0011-*`、`0012-*`
- 因此**所有新文件都是未跟踪/未提交的**，切换分支或清理工作区前先提交。
- 另有与本会话无关的未跟踪目录：`.codegraph/`、`.qwen/agents/`、`.scratch/review-screenshots/`——不要顺手提交。

## What was delivered

三份 spec + 17 张票 + 3 份 ADR + 术语表。内容都在文件里，这里不复制：

| 主题 | Spec | 票 | ADR |
|---|---|---|---|
| ① 画布库与多画布 | `.scratch/canvas-library/spec.md` | `issues/01`–`06` | `docs/adr/0010-canvas-library.md` |
| ② 工作区布局与画布缩放 | `.scratch/workspace-layout-and-zoom/spec.md` | `issues/01`–`05` | `docs/adr/0011-viewport-transform-zoom.md` |
| ③ 监控可读性 | `.scratch/monitor-readability/spec.md` | `issues/01`–`06` | `docs/adr/0012-log-direction-and-topology.md` |

术语：`GLOSSARY.md`（画布文档、画布库、会话记录、追踪、消息、方向、组件、拓扑、缩放）。

## Tickets status

全部 `ready-for-agent`，无 `done`。

| # | 票 | Blocked by |
|---|---|---|
| ①01 | 画布列表接口 | — |
| ①02 | 画布删除接口 | — |
| ①03 | 缩略图 | — |
| ①04 | 画布库视图与路由 | ①01（02/03 落地后接删除与缩略图） |
| ①05 | 会话记录按画布分区 | — |
| ①06 | 旧机制退场 | ①04 |
| ②01 | 右栏两列 + 可拖宽度 | — |
| ②02 | 对话垂直空间修复 | — |
| ②03 | 窄屏单抽屉两段 | ②01, ②02 |
| ②04 | Fabric 真缩放与平移 | — |
| ②05 | 缩放下的高亮换算 | ②04 |
| ③01 | 日志方向 source/target | — |
| ③02 | 追踪补全 canvas-action/sse | ③01 |
| ③03 | 追踪摘要接口 | ③01 |
| ③04 | 按追踪聚合的列表 + payload | ③03 |
| ③05 | 时序图 / 层级树 | ③01, ③02, ③03 |
| ③06 | 拓扑图 | ③01, ③03 |

推荐路线：`①01 → ①04 → ①05`（找得回、对话不串）→ `②01/②04`（手感）→ `③01 → ③03 → ③04`（看得懂）。三组之间不共享文件，可并行。

## 三个「由决定推出、用户没有逐条批准」的点

用户两轮都答「按你的来」，但下面三条是**推论**而非他点名的选择。若产品反对，各改一处即可，不影响其余：

1. **新建确认条 `NewCanvasConfirm` 退场**（①spec §7、票 ①06）。它的存在理由是「旧画布可能找不回来」，画布库让这句话失效。
2. **浏览器后退接管**（①spec §5）。进入画布用 `pushState`，后退回库；这**明确撤销**了 `.scratch/release-hardening/issues/04-canvas-identity.md:76` 的决定——老票只追加 `## Comments`，不改状态与验收（历史不改写，见 ADR-0008 §6 的同一原则）。
3. **逐条日志改按 `id DESC` 排序**（③spec §5、票 ③04）。`timestamp` 是 span 开始时间，按它排会让完成记录「排在前面、来得最晚」；要改的是服务端 `AgentLogRepository.query` 的 `ORDER BY`，只改前端无效。

## Decisions made (do not re-litigate)

只列容易被重新讨论、且理由不在代码里的几条：

| Decision | Choice |
|---|---|
| 多画布形态 | 一次一张活动画布 + 独立画布库视图，不做标签页/分屏（ADR-0010） |
| 「保存」语义 | 不变：持久化即保存（ADR-0008）；画布库是找回入口 |
| 对话记录 | 会话态、按 `canvasId` 分区、刷新即失；**不**新增服务端消息表（沿用 UX-24） |
| 缩略图 | 浏览器懒生成 + 独立表 `canvas_thumbnails`；列表只返回 `hasThumbnail` |
| 删除 | 硬删除 + 级联 + 调已存在但从未被路由使用的 `deleteThread()` |
| 缩放实现 | Fabric `viewportTransform`，不用 CSS `transform`（ADR-0011） |
| 日志方向 | 新增 `source`/`target` 两列，词表 `browser|daemon|codex|model|sqlite`；旧数据只回填 http/sse（ADR-0012） |
| 追踪内部视图 | 时序图为默认，层级树可切 |
| 拓扑图 | 静态声明 + 手写 SVG + 实时叠加；零新增依赖 |

## Gotchas

- **`payload` 从来没被渲染过**是「监控看不懂」的第一原因，不是缺少分组。票 ③04 必须先做明细，否则只是把 139 行一样的东西折叠成 30 组一样的东西。
- **`sse` / `canvas-action` / `system` 目前没有 `traceId`**，这些行在列表里点不开；而且 AI 改画布的那一跳不在对话追踪里（票 ③02）。
- **`/monitor/events` 刻意不打日志**（防回环，`routes.monitor.ts:23-29`）；不要"顺手"给它加追踪。
- **统计口径的修复已落地**（commit `070b925`：错误率 hint、小样本成功率、取消不算失败）。不要按旧审计文档重做 MON-01/MON-02/AI-03。
- **`agent_logs` 无保留策略**，无界增长。追踪摘要接口必须带时间窗口，否则 `GROUP BY trace_id` 会越来越慢。
- **`avgDurationMs` 混入了长连接**（SSE hijack 流），拓扑图显示平均耗时要剔除 `durationMs > 10_000`。
- **`PRAGMA foreign_keys = ON` 已打开**（`database.ts:14`），删除画布的级联是真实生效的。
- **`?page=` 是视图参数**，不是 `?view=`；画布视图本身不带 `page`（`view-route.ts`）。
- **测试与构建**：`pnpm -r test`、`pnpm -r typecheck`、`pnpm build`。Windows 上 `pnpm -r build` 偶发 esbuild temp 清理失败，见 `README.md` 的 workaround（把 `TEMP`/`TMP` 指到 `.agents/build-tmp`）。
- **无浏览器 E2E**：布局、拖拽、缩放、拓扑全部要手动验收。

## Suggested skills

Call the Skill tool for:

- **`tdd`** — 这三块都有清晰的纯函数边界（`fitScale`/`clampScale`/`docToScreen`、`buildSequence`、方向映射表），适合先写测试。
- **`code-review`** — 每份 spec 实现完一轮后，按「Spec + Standards」双轴复查；很容易出现"实现顺手多做了 spec 之外的东西"。
- **`diagnosing-bugs`** — 若缩放后笔刷落点偏移，这是本设计最可能出问题的地方（坐标换算）。
- **`handoff`** — 实现进行到一半需要交接时。
- **`grilling`** — 只有当你打算推翻上面「derive 未批准」的三条之一时，先把影响面问清楚。

不要用 `domain-modeling` 重写术语——`GLOSSARY.md` 已按本轮结论定稿。

## Context pointers

| Need | Read |
|---|---|
| ① 的行为、接口、验收 | `.scratch/canvas-library/spec.md` |
| ② 的行为、CSS/缩放契约 | `.scratch/workspace-layout-and-zoom/spec.md` |
| ③ 的方向映射表、拓扑、时序图 | `.scratch/monitor-readability/spec.md` |
| 为什么这样定 | `docs/adr/0010-*`、`0011-*`、`0012-*` |
| 领域词汇 | `GLOSSARY.md` |
| 既有监控实现与延迟项 | `docs/adr/0006-agent-observability.md`、`.scratch/agent-observability/spec.md` |
| 保存语义（不要改） | `docs/adr/0008-save-semantics.md` |
| 被本轮推翻的旧决定 | `.scratch/release-hardening/spec.md:136`、`:176`；`.scratch/release-hardening/issues/04-canvas-identity.md:76` |
| 票据与状态规范 | `docs/agents/issue-tracker.md`、`docs/agents/triage-labels.md` |

## 下一步

从票 ①01 开始（`GET /paint/canvas`）：它是画布库视图的唯一前置，且不依赖任何前端改动。

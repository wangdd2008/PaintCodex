# Release Hardening Spec

> PaintCodex 发布前收口：不新增板块，只把已经做到的能力如实呈现出来，并把图层、画笔、AI 等待与连接状态补完整。

## Problem Statement

Phase 1 已经能完成「建画布 → 画 → 刷新 → 导出」。服务端持久化、撤销/重做、多标签同步、AI 生成图层、监控 trace 都在现场验证过。

真正拖累首次体验的不是功能少，而是**三个错误信号**：

1. **没有画布时，画布看起来能画，笔画却静默消失。** `CanvasStage.handlePathCreated` 在无画布文档时直接 `canvas.remove(path)`，没有提示（`apps/web/src/features/canvas/CanvasStage.tsx:81-83`）。
2. **每 30 秒自动下载一次 JSON，把「导出」伪装成「保存」；真正的持久化状态反而不可见。** 该行为来自 `.scratch/canvas-save-and-localization/spec.md` 与已关闭的 `issues/02-auto-save.md`，不是误实现；但它既让用户以为已经保存，又污染下载目录，而且在保存失败时笔画会被 `canvas.remove(path)` 吃掉。
3. **状态栏写「缩放 100%」，实际显示 44.7%；监控同时显示「错误率 0.0%」和「1 个错误」。** 代码里根本没有任何缩放计算，1920 宽的 canvas 由 CSS 拉伸（`apps/web/src/app/app.css:136-139`）；监控的错误率只统计 HTTP，错误数却统计全部分类（`apps/daemon/src/observability/repository.ts:133-185`）。

这三类问题指向同一条产品原则：**系统状态必须诚实、可见、可行动。**

## Solution

把「状态诚实」作为唯一主线，分四波交付：

- **第一波（止血）**：无画布门禁、停止自动下载、监控口径、命名唯一、中文化。
- **第二波（信任与首次体验）**：保存状态与失败保留、错误横幅、空状态主 CTA、画布身份（重命名/返回上一张）、图层布局、删除恢复条。
- **第三波（AI 与连接）**：AI 计时与落地确认、AI 错误可恢复、连接状态指示。
- **第四波（能力补全）**：选中图层语义与键盘可达、图层名称/透明度/类型、画笔颜色与粗细、窄屏可用。

本轮不引入新模块、不改数据模型（仅新增一条只接受 `name` 的画布更新路由）、不改撤销机制（继续使用快照级撤销，ADR-0003）。

## User Stories

1. As a first-time user, I want the canvas to refuse to draw until a canvas exists, so that my first stroke is never silently discarded.
2. As a user, I want exactly one honest save status, so that I know whether my work has been persisted.
3. As a user, I want a failed stroke to stay visible and retryable, so that a daemon hiccup does not eat my drawing.
4. As a user, I want to name a canvas and get back to the previous one, so that my exports stop overwriting each other.
5. As a user, I want a visible result after every operation (create, delete, AI generate, export), so that I never have to guess what happened.
6. As a user waiting for the AI, I want a timer, phases, and a landing confirmation, so that I know the run is alive and what it produced.
7. As a user whose AI run failed, I want a retry that reuses my message and does not lose my draft, so that a transient failure is not a dead end.
8. As a user in a second tab, I want to see when the realtime channel dropped and recovered, so that I do not trust a stale canvas.
9. As a keyboard or screen-reader user, I want layer rows to be focusable and selectable, so that I can manage layers without a mouse.
10. As a user with a narrow window, I want to finish the core flow (create, draw, undo, export) at 360px and above.
11. As an operator, I want the monitor's numbers to be recomputable from their labels, so that I do not conclude "no errors" while an error is on screen.
12. As a user, I want color and width control for the brush, so that I am not limited to a 2.7px black line while the AI can draw in color.

## Scope

Commitment is **20 items**: `UX-01` … `UX-20`. `UX-21` … `UX-26` (P2) are explicitly out of this round.

| UX | 主题 | 票 |
|---|---|---|
| UX-01 | 无画布时画布可交互、笔画静默丢弃 | 01 |
| UX-02 | 自动下载伪装保存、无保存状态、失败丢笔画 | 02 |
| UX-03 | 监控错误率与错误数口径矛盾 | 03 |
| UX-04 | 首次进入无主 CTA、AI 空承诺 | 01 |
| UX-05 | 新建无确认、旧画布不可达 | 04 |
| UX-06 | 所有画布都叫 Untitled、导出互覆 | 04 |
| UX-07 | 删除中间图层后新笔画重名 | 05 |
| UX-08 | 状态栏硬编码 100%、信息重复 | 02 |
| UX-09 | 「当前图层」空转、图层行键盘不可选 | 08 |
| UX-10 | 图层按钮命中区过小、可见性语义混用 | 07 |
| UX-11 | 图层增长挤压 AI 对话、侧栏整体滚动 | 06 |
| UX-12 | 原生 confirm、删除后无恢复入口 | 10 |
| UX-13 | 名称/透明度/类型能力未暴露 | 09 |
| UX-14 | AI 等待无计时、成功后无落地确认 | 11 |
| UX-15 | AI 错误不可恢复、草稿不回、英文错误 | 12 |
| UX-16 | 取消被算作 AI 失败、小样本显示确定百分比 | 03 |
| UX-17 | 画布 SSE 断线无感知 | 13 |
| UX-18 | 窄屏不可用（390px 画布 34×18） | 14 |
| UX-19 | 8 处本地化遗漏 + `lang="en"` | 05 |
| UX-20 | 画笔固定颜色/宽度 | 15 |

## Superseded Decisions

本轮的三个决定推翻了既有文档，必须显式记录，否则下一个人会以为是回归：

1. **30 秒自动下载 JSON（已撤销）。** `.scratch/canvas-save-and-localization/spec.md` 的 User Story 2 与 `issues/02-auto-save.md`（`Status: done`，验收已勾选）明确要求它。撤销的是**机制**，不是**意图**：用户想「别丢工作」是合理的，由服务端持久化 + 可见保存状态 + 失败保留笔迹承接。见 `docs/adr/0008-save-semantics.md`。原票只追加 `## Comments` 标注被取代，不改历史状态。
2. **「AI 失败不自动重试」（已撤销）。** `.scratch/ai-chat-ux-improvements/spec.md` 的 `## Out of Scope` 写了 `Auto-retry on timeout or error`。本轮把「重试」纳入（票 12），因为错误分类与重试是同一个交互的两半。
3. **「`chat_completed` 之后不再追加 step」（部分修改）。** `docs/adr/0007-ai-chat-ux-improvements.md` 规定完成后 step 序列结束。本轮不改序列，只在完成后保留一行终态「已完成 · 用时 Ns」，并消费已被后端发送、前端从未读取的 `layerCreated`。

## Implementation Decisions

### 1. 画布状态机

画布区只有四种状态，互斥且必须可视区分：

| 状态 | 判定 | 呈现 |
|---|---|---|
| 无画布（No Canvas） | 无 `canvasId`，也没有已加载的文档 | 空状态层 + 唯一主 CTA「开始一张画布」；画笔/选择禁用；AI 输入禁用 |
| 加载中 | 有 `canvasId`，`GET /paint/canvas/:id` 进行中 | 骨架/加载文案；不渲染可交互白画布 |
| 加载失败（Load Failure） | 有 `canvasId`，`GET` 失败 | 原因 + 「重试」+「新建画布」；不渲染可交互白画布 |
| 就绪（Ready） | 文档已加载 | 正常绘制；空文档即空画布（Empty Canvas），可绘制 |

防守性 guard 保留：即使 UI 状态错乱，`handlePathCreated` 也不得丢弃笔画而不提示。

### 2. 三种反馈面，没有全局 toast

| 反馈面 | 承载 | 生命周期 |
|---|---|---|
| 画布区顶部错误横幅（`role="alert"`） | 画布级错误：保存失败、加载失败、操作失败 | 出现于 mutation 失败；该 mutation 重试成功或用户手动关闭时消失；刷新画布成功**不**清除（它描述的是那一次操作） |
| 状态栏 | 保存状态、连接状态、真实缩放、尺寸 | 常驻，按状态机切换 |
| 面板内恢复条 | 删除、图层生成的单次撤销 | 8 秒，或 revision 变化即失效 |

同一时刻每个反馈面最多一条。全局 toast 本轮不做（见 `## Out of Scope`）。

### 3. 保存状态语义

`保存状态` 只反映**持久化**，不反映导出：

| 状态 | 触发 | 文案 |
|---|---|---|
| 保存中 | mutation 发出，防抖 ≤500ms | `保存中…` |
| 已保存 | mutation 成功 | `已保存 · 刚刚` → `已保存 · N 秒前` → `已保存 · N 分钟前` |
| 保存失败 | mutation 失败 | `保存失败 · 重试` |

连续笔画用 ≤500ms 防抖，避免状态闪烁。持久化成功即「已保存」，不存在「需要用户点保存才保存」的中间态。

### 4. 撤销守卫

撤销仍是快照级（ADR-0003）。恢复条与 AI 落地撤销都绑定 **revision**：仅当 `currentRevision === expectedRevision` 时可点；否则降级为纯文本（「已被后续操作覆盖」「已有后续操作」），不提供撤销入口。这样「撤销」永远不会撤掉用户意料之外的东西。

### 5. 监控口径

- 卡片更名 **HTTP 错误率**，hint 形如 `0 失败 · 2 冲突 / 24 请求`；分子分母都在文案里，可复算。
- 另起一行 **全部错误**：`1 · ai-chat 1`，与分类条错误计数一致。
- 分母为 0 显示 `—`，不显示 `0.0%`。
- 成功率分母剔除 `aborted:true`，单列 **取消** 计数；成功次数 `n < 5` 时显示 `—`。
- 统计聚合排除 `/monitor/*` 请求（**日志保留**，只是不进统计），监控不观测自己。
- 4xx（`warn`）继续计入失败，但在 hint 中与 `error` 分开呈现。

### 6. 画布身份

- 新建默认名 `未命名 YYYY-MM-DD HH:mm`（daemon 侧默认值）。
- 新增 `PATCH /paint/canvas/:id`，**只**接受 `name`（trim 后 1–80 字符，否则 `400`）；传其他字段返回 `400`。响应为更新后的画布文档，形状与 `GET /paint/canvas/:id` 一致。
- `POST /paint/canvas` 对 `name` 施加同一套校验（现状是零校验，非字符串会在 `input.name?.trim()` 抛错）。
- 有画布时新建先确认；新建失败不覆盖当前 `canvasId` 与 localStorage。
- 返回上一张：优先 `previousCanvasId`（单级，够用），不引入 `pushState`/路由。
- 浏览器后退**不接管**：应用内返回入口由按钮承担。票 04 的「`history.back()` 不再离开应用」按此解释——浏览器后退仍会回到进入前的页面（与基线一致），这是有意取舍，不是遗漏。
- 本轮不做画布列表。

### 7. 图层列表

- 列表方向**本轮不翻转**（顶层仍在最上，与现状一致）；所有改动不得依赖方向字面量。
- `选中图层（Active Layer）` 的含义是**选中/定位**，不是绘制目标：AI 图层设为 Fabric `activeObject`，笔迹图层 800ms ±100ms 高亮。一笔仍然只生成一个图层。
- 行内重命名与透明度**作用于该行**，与 `activeLayerId` 无关。
- 面板布局：侧栏 `overflow:hidden`；图层面板 `max-height:300px` 且列表独立滚动；AI 面板 `flex:1; min-height:240px`；新图层 `scrollIntoView({block:'nearest'})`。
- 命中区：所有行内控件 ≥24×24，可见性 ≥28×28，行高 36–40px；靠热区扩展，不放大字形。

### 8. 中文化边界

`<html lang="zh-CN">`。除白名单外不出现英文句子。白名单：`PaintCodex`、`PNG`、`JSON`、`SVG`、`AI`、`Codex CLI`、`traceId`、`http_request`、`sse_subscribe`、`chat_completed`、监控分类名（含 `ai-chat`）。

默认名与图层名中文化**只影响新建**：已有画布名为空或仍为 `Untitled` 时，前端显示兜底为「未命名」，但**不写回数据库**（批量改写用户数据不可逆，会污染导出名与历史）。图层默认名 `Stroke N` → `笔迹 N`，旧图层不改名。

### 9. 窄屏承诺

正式承诺：**桌面优先，窄屏 ≥360px 可用；完整移动端不在本轮，也不在 Phase 1。**

断点：`≤1100px` 侧栏 `clamp(260px,24vw,320px)`、工具条 48px；`≤860px` 侧栏改覆盖式抽屉 `min(320px,86vw)`（Esc 关闭、焦点返回）、菜单允许换行、隐藏文档名；`≤560px` 抽屉接近全宽、导出进第二行、状态栏允许换行。画布最小可用宽度 ≥280px。

不做：触控手势、双指缩放、移动端专用工具栏。

### 10. 画笔

颜色：黑、深灰、红、橙、蓝、绿 + 自定义颜色。粗细：2/4/8/16 四档，带预览。默认颜色 `#111111`、默认宽度 **6**（1264×625 下屏幕笔宽 ≥2.5px）。设置存会话状态，刷新回默认。

## Testing Decisions

验收必须是**可观察行为**，不能是实现动作。上一轮的 `02-auto-save.md` 把验收写成「添加 `useEffect` + `setInterval`」——实现式验收既保证了「合格交付」，也保证了缺陷发生。

- **每张票至少一条自动化断言**：web 侧用 React Testing Library 断言可见状态与网络调用；daemon 侧用 Fastify 注入断言 SSE 负载与状态码；统计口径用 repository 单测。
- **门禁**：`pnpm -r typecheck` 与 `pnpm -r test` 通过。
- **人工验收**：`.scratch/product-audit/report.md` 第 10 节的脚本，仅用于视觉、触控、读屏这类机器难验的项；其中 390×844、200% 缩放、Tab 焦点环必须实际走一遍。
- 量化判据写在票里（时间、像素、宽高、计数），不写「体验更好」。

## Out of Scope

- P2 六项：`UX-21` 可访问性收口、`UX-22` 监控分页与暂停语义、`UX-23` 导出反馈与 JSON 备份语义、`UX-24` 对话持久化边界、`UX-25` 视觉一致性、`UX-26` 图层顺序标识与 pending 反馈
- 画布列表/画廊/多画布管理（单级返回即可）
- 模板、示例画布、新手教程
- JSON 导入、`.aipaint` 文件格式（Phase 1 明确排除）
- 完整缩放/平移/抓手/缩放控件（只修真实比例显示）
- 图层重排/合并/编组/锁定/搜索（`zIndex` 不可 PATCH，属协议扩展）
- 笔刷硬度/压感/纹理
- 完整移动端/触控手势/双指缩放
- i18n 框架、英文界面
- 设计系统/主题/组件库
- 全局 toast
- 自定义删除确认弹窗（直接删除 + 恢复条）
- 离线队列、手动重连、冲突合并 UI
- 对话历史数据库、多轮记忆、会话恢复
- 监控告警、日志保留清理、虚拟滚动、全文检索（ADR-0006 已 deferred）
- 画布的键盘/读屏绘画替代
- 全站 WCAG 审计、自动化 a11y 测试

## Implementation Order

波次是**排序**，不是阻塞。票里的 `**Blocked by:**` 只写真实依赖。

| 波次 | 目标 | 票 | 出口条件 |
|---|---|---|---|
| Wave 0 止血 | 消除确定性丢笔画、文件污染、重名与监控矛盾 | 01（门禁部分）、02（删除自动下载部分）、03、05（命名部分）、07 | 无画布不产生路径；空闲 30 分钟 0 下载；重名消失；监控两数可复算；图层按钮 ≥24×24 |
| Wave 1 信任 | 用户知道「我在哪、画有没有保存、怎么开始、怎么回来」 | 01（空状态 CTA）、02（保存状态与横幅）、04、06、10 | 断 daemon 画一笔不丢且可重试；首次进入有主 CTA；新建可返回；状态栏显示 44.7%；删除有恢复条；8 层聊天区 ≥240px |
| Wave 2 AI 与连接 | 等待可解释、成功有落地、失败可恢复、取消不误导指标 | 11、12、13 | 20 秒等待有秒数；成功有「已添加图层」；错误中文可重试；取消不降成功率；断线 3 秒内可见 |
| Wave 3 能力补全 | 把已有数据能力暴露出来 | 08、09、15、14 | 点击图层有画布反馈；键盘可完成图层管理；默认笔宽屏幕 ≥2.5px；390px 可完成核心流程 |

> 票 01、02、05 各自跨两个波次：验收里能独立交付的部分先做，其余留到下一波。这是票据内部的顺序，不拆票。

## Assumptions & Confidence

- 本轮**没有**用户访谈、行为数据或支持票据。所有「用户影响」都是基于现场行为与界面语义的推断。
- 优先级由「错误信号」驱动，不由用户数据驱动：三个 P0 都是确定性错误（画一笔必丢、空闲必下载、数字必矛盾），不需要数据背书即可开工。
- 结论的置信度：P0 高（可复现、可观测）；P1 中（现场可见，影响面未量化）；P2 低（打磨项，未验证）。
- 5 人任务测试（首次画一笔 / 刷新 / 导出 / 新建 / AI 生成）作为**本轮出口的验证输入**，不作为开工门禁。它决定下一轮是否继续投入，不决定本轮是否修。

## Tickets

| # | Ticket | Blocked By |
|---|---|---|
| 01 | [无画布门禁与空状态入口](issues/01-no-canvas-gate.md) | None |
| 02 | [保存状态、错误横幅与失败保留](issues/02-save-status-and-errors.md) | None |
| 03 | [监控口径](issues/03-monitor-metrics.md) | None |
| 04 | [画布身份：新建确认、返回上一张、重命名](issues/04-canvas-identity.md) | None |
| 05 | [命名唯一与中文化](issues/05-naming-and-localization.md) | 04 |
| 06 | [图层面板布局](issues/06-layer-panel-layout.md) | None |
| 07 | [图层命中区与可见性语义](issues/07-layer-hit-targets.md) | 06 |
| 08 | [选中图层语义与键盘可达](issues/08-active-layer-and-keyboard.md) | 06 |
| 09 | [图层名称、透明度与类型](issues/09-layer-name-opacity-type.md) | 05, 06 |
| 10 | [删除恢复条与撤销守卫](issues/10-delete-undo-bar.md) | 02, 06 |
| 11 | [AI 等待与落地确认](issues/11-ai-waiting-and-confirmation.md) | 02 |
| 12 | [AI 错误可恢复](issues/12-ai-error-recovery.md) | 02 |
| 13 | [连接状态指示](issues/13-connection-status.md) | 02 |
| 14 | [窄屏可用](issues/14-narrow-viewport.md) | 06 |
| 15 | [画笔颜色与粗细](issues/15-brush-color-and-width.md) | None |

## Related

- 审计与证据：`.scratch/product-audit/report.md`（含勘误）、`findings/`、`evidence/`、`screenshots/`
- 决策记录：[ADR-0008 保存语义](/docs/adr/0008-save-semantics.md)
- 被取代：[canvas-save-and-localization/spec.md](../canvas-save-and-localization/spec.md)、[ai-chat-ux-improvements/spec.md](../ai-chat-ux-improvements/spec.md)、[ADR-0007](/docs/adr/0007-ai-chat-ux-improvements.md)
- 沿用：[ADR-0003 快照级撤销](/docs/adr/0003-snapshot-undo.md)、[ADR-0004 全量快照推送](/docs/adr/0004-sse-full-snapshot-push.md)、[ADR-0005 客户端 PNG 导出](/docs/adr/0005-client-side-png-export.md)

## Further Notes

- 本仓库的「Phase」词表已失同步：`docs/architecture-design.md:628-656` 的路线图仍把 AI、Undo、SSE 列为未完成，`ADR-0006` 状态写着 `Accepted — Phase 2` 而监控已在 Phase 1 上线。本轮因此不使用阶段号，改用「发布前收口」。路线图订正另行处理。
- 报告 §4 UX-16 的验收「1 成功 + 1 取消 → 100.0%（1/1）」被本轮口径取代：`n < 5` 一律显示 `—`，hint 保留 `1/1 次对话 · 1 取消`。
- 报告 §4 UX-14 的「前端丢弃 `layerCreated`」需精确理解：图层不会丢，`snapshot_changed` 会刷新出来；缺的是对话内的落地确认。
- 报告 §2 UX-08 的 44.8% 是算术笔误，858/1920 = 44.7%。

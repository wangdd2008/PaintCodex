# 01: 无画布门禁与空状态入口

**What to build:** 没有画布时，画布区不再呈现一张「看起来能画」的白画布，而是给出唯一主 CTA；画笔、选择、AI 输入都不可用；加载失败与「无画布」呈现为两种可区分的状态。

**Blocked by:** None (can start immediately)

**Status:** done

**Covers:** UX-01, UX-04

**Size:** M

## Acceptance Criteria

- [x] 无画布（无 `canvasId` 且无已加载文档）时，画笔与选择不可激活，画布不接受 pointer 事件；点击画布不产生 `path:created`。
- [x] 无画布时即使状态错乱产生了 path，`handlePathCreated` 也不得静默 `remove`：必须保留或给出可见提示（防守性 guard）。
- [x] 无画布时画布区显示唯一主 CTA「开始一张画布」，可 Tab 聚焦、Enter 与 Space 均可触发；图层面板显示「还没有画布」。
- [x] 无画布时 AI 输入框 `disabled` 并显示原因文案；不得出现 AI 的「可以添加图层」类回复（当前会主动承诺作画）。
- [x] 加载失败（有 `canvasId` 但 `GET /paint/canvas/:id` 失败）呈现为：中文原因 + 「重试」+「新建画布」，且不渲染可交互白画布；重试成功后进入「就绪」。
- [ ] 有画布时画第一笔，图层列表出现「笔迹 1」，刷新后仍在。
- [ ] 首次进入不出现 `Blank`、`Untitled` 字面量（与票 05 一起验收）。
- [x] 自动化：无画布时点击画布不触发任何 fetch（组件测试断言网络调用为 0）；加载失败态断言「重试」可点且重试发出 1 次 GET。

## Notes

- 状态机见 spec §1「画布状态机」：无画布 / 加载中 / 加载失败 / 就绪，四态互斥。
- 空状态 CTA 是首次会话的唯一入口，位置在画布区中央，不要放回右上角菜单。

## Comments

2026-10-26 — 实现完成并提交到 `ticket/01`（基于 `feat/release-hardening` `6d23cc0`）。

- Implementation commit: `f96996c`。
- 四态互斥：`CanvasStage` 只有「就绪」才挂载 Fabric；无画布渲染空状态层，加载中渲染「正在加载画布…」，加载失败渲染中文原因 +「重试」+「新建画布」，三种非就绪态都不存在可交互白画布与 `<canvas>`。
- 无画布时 `Toolbox` 的「画笔」「选择」禁用；`handlePathCreated` 保留防守 guard，不 `remove` 笔画，保留在画布上并显示可见提示「没有画布，这一笔没有保存。」。
- 空状态唯一主 CTA「开始一张画布」位于画布区中央，可 Tab 聚焦，Enter/Space 均触发 `createNewCanvas`；无画布时菜单栏不再重复「新建画布」，避免第二入口。
- AI 输入框在无画布/加载失败时 `disabled` 并显示原因；`send` 再用 store 判一次，避免 AI 空承诺。
- 为区分「加载失败」与「无画布」，`canvas-store` 新增 `requestedCanvasId`：`loadCanvas` 记录目标 id，失败时保留，成功后等于 `canvas.id`；失败态「重试」复用该 id 发 GET，无 id 时回退为新建。
- 图层面板空态文案改为「还没有画布」。
- 测试：新增 `apps/web/test/canvas-gate.test.tsx` 8 个用例（无画布点击 0 fetch、唯一 CTA、Enter/Space、加载中、失败态「重试」1 次 GET 后恢复就绪、图层面板空态、画笔/选择禁用）；`ai-chat-panel.test.tsx` 新增 2 个禁用用例，既有用例改为以「就绪画布」为前置。web 73 passed，daemon 103 passed；`pnpm -r typecheck` 通过。
- 未勾选项：`笔迹 1` 命名依赖票 05（本票未改 `Stroke N`，遵守不跨票做本地化）；`Untitled` 依赖票 04/05 的默认命名，本票只移除了无画布态的 `Blank`。
- 需浏览器人工复核：无画布时 Tab 焦点环与 Enter/Space 实际触发；真实 Fabric 未初始化、拖拽不产生笔画；加载失败「重试」成功后真实渲染与尺寸；AI 禁用态视觉与读屏播报。jsdom 测试 mock 了 Fabric，无法覆盖真实 pointer/path:created。

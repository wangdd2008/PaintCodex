# 01: 无画布门禁与空状态入口

**What to build:** 没有画布时，画布区不再呈现一张「看起来能画」的白画布，而是给出唯一主 CTA；画笔、选择、AI 输入都不可用；加载失败与「无画布」呈现为两种可区分的状态。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

**Covers:** UX-01, UX-04

**Size:** M

## Acceptance Criteria

- [ ] 无画布（无 `canvasId` 且无已加载文档）时，画笔与选择不可激活，画布不接受 pointer 事件；点击画布不产生 `path:created`。
- [ ] 无画布时即使状态错乱产生了 path，`handlePathCreated` 也不得静默 `remove`：必须保留或给出可见提示（防守性 guard）。
- [ ] 无画布时画布区显示唯一主 CTA「开始一张画布」，可 Tab 聚焦、Enter 与 Space 均可触发；图层面板显示「还没有画布」。
- [ ] 无画布时 AI 输入框 `disabled` 并显示原因文案；不得出现 AI 的「可以添加图层」类回复（当前会主动承诺作画）。
- [ ] 加载失败（有 `canvasId` 但 `GET /paint/canvas/:id` 失败）呈现为：中文原因 + 「重试」+「新建画布」，且不渲染可交互白画布；重试成功后进入「就绪」。
- [ ] 有画布时画第一笔，图层列表出现「笔迹 1」，刷新后仍在。
- [ ] 首次进入不出现 `Blank`、`Untitled` 字面量（与票 05 一起验收）。
- [ ] 自动化：无画布时点击画布不触发任何 fetch（组件测试断言网络调用为 0）；加载失败态断言「重试」可点且重试发出 1 次 GET。

## Notes

- 状态机见 spec §1「画布状态机」：无画布 / 加载中 / 加载失败 / 就绪，四态互斥。
- 空状态 CTA 是首次会话的唯一入口，位置在画布区中央，不要放回右上角菜单。

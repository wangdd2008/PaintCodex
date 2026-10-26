# 11: AI 等待与落地确认

**What to build:** 20 秒的等待不再只剩「AI 正在思考…」：有秒数、有阶段、有终态；生成成功后消费后端已经发送的 `layerCreated`，在对话里给出落地确认与可撤销入口。

**Blocked by:** 02 (错误/状态反馈面)

**Status:** ready-for-agent

**Covers:** UX-14

**Size:** S

## Acceptance Criteria

- [ ] 发送后每 1 秒更新「已用 Ns」。
- [ ] 首个 `delta` 到达后切换为「正在生成…」；`step` 事件仍按 ADR-0007 的四段文案驱动，不改变序列。
- [ ] 完成后保留终态「已完成 · 用时 Ns」，不清空为空白。
- [ ] 消费 `layerCreated { id, name }`：助手气泡下显示「已添加图层「AI — 红色圆形」· 撤销」。
- [ ] 撤销仅在 `currentRevision === 生成时 revision` 时可用；否则降级为纯文本，不显示撤销入口。
- [ ] 撤销只撤该步，不撤后续用户操作。
- [ ] 自动化：SSE 注入 `step*` + `layerCreated` + `done`，断言计时文案、终态与确认行的出现顺序。

## Notes

- 图层不会因为前端未消费 `layerCreated` 而丢失：`snapshot_changed` 全量刷新会把它带出来。缺的只有对话内的确认，因此本票不做数据抢救逻辑。
- 后端已在 `routes.ai.ts` 发送该字段，前端零引用；本票只补消费端。

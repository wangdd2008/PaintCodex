# 07: canvas_select 工具（AI 指示焦点）

**What to build:** 让 AI 能把用户的注意力引到某个图层或区域上——纯 UI 焦点，不改画布、不落库、不进快照。

**Blocked by:** 无（依赖 01 的运行时与 02 的工具事件行，二者已合入）

**Status:** ready-for-agent

背景：spec 与 ADR-0009 的工具表列了 7 个工具，落地过程中 `canvas_select` 被漏掉（01 只做了读+建，02 做改/删/撤销，04 做预览，06 做导出）。这一票补齐，使代码与文档一致——否则「工具集是刻意的小」就会变成「工具集是随意的少」。

- [ ] 声明 `canvas_select`（`{ canvasId, layerId?, region? }`），二选一必填
- [ ] 执行时经 SSE 通知前端把该图层设为「选中图层」（`Active Layer`），并短暂高亮；`region` 用于画布上圈出区域
- [ ] 不写数据库、不产生快照、不 bump revision、不进撤回栈
- [ ] 目标不存在时返回 `{ ok:false, code:'layer_not_found' }`（与其它工具一致，模型可读）
- [ ] 前端：图层面板选中 + 画布高亮，3 秒后自动淡出；用户正在绘制时不打断当前笔画
- [ ] 测试：工具入参校验（layerId / region 二选一）、成功通知帧、未知图层、Web 侧选中与淡出
- [ ] `pnpm -r typecheck`、`pnpm -r test` 连续两次通过

## Comments

2026-10-28 — 由父代理在合并期审计发现：`tools.ts` 只声明了 6 个工具，缺 `canvas_select`。补票而非改文档，因为 ADR-0009 与架构文档已把 7 个工具写成对外契约。

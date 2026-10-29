# 06: 「返回上一张」与新建确认条退场

**What to build:** 删除为弥补「没有画布库」而生的两个机制，避免出现两套返回路径。

**Blocked by:** 04

**Status:** done

**Covers:** 画布库 §7

**Size:** S

## Acceptance Criteria

- [x] 删除 `previousCanvasId`、`returnToPreviousCanvas`、菜单栏「返回上一张」按钮及其样式。
- [x] 删除 `NewCanvasConfirm` 组件；「新建画布」直接执行，成功后跳到新画布。
- [x] 删除 `NewCanvasConfirm` 的测试与 `canvas-identity.test.tsx` 中只覆盖确认条的用例。
- [x] 菜单栏不再出现「处理中…」的确认态文案残留。
- [x] 全仓 grep `previousCanvasId` / `returnToPreviousCanvas` / `NewCanvasConfirm` 无残留（测试替身除外）。
- [x] 画布库入口取代它们成为唯一的文档间导航。

## Notes

- 这一票是 `release-hardening/issues/04-canvas-identity.md` 的反向操作。**不要**改写那张票的状态或验收（历史不改写）；在它的 `## Comments` 追加一条指向 `docs/adr/0010-canvas-library.md` 的说明即可。
- 删确认条是本轮唯一一件用户没有逐条批准的事——它由画布库直接推出。若产品否决，保留确认条即可，其余不受影响。

- 2026-10-29 · 实现完成：`109e1aa`，合入 integration 分支 `feat/canvas-library-workspace-monitor`（merge `62cb35b`）；+dc18667 旧票 Comments；经 code-review 双轴复查与统一修复（`4475df8`/`bdcc10a`）后验收全部满足，关闭。

# 02: 画布删除接口 `DELETE /paint/canvas/:id`

**What to build:** 硬删除一张画布，级联清图层/快照/缩略图，并清掉它的 Codex thread。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

**Covers:** 画布库 §3

**Size:** S

## Acceptance Criteria

- [ ] `DELETE /paint/canvas/:id` 成功返回 `204`（无 body）。
- [ ] 不存在返回 `404 {"error":{"code":"canvas_not_found","message":"画布不存在"}}`。
- [ ] 删除在事务内完成；`layers`、`snapshots`、`canvas_thumbnails` 的对应行随之外键级联删除（`PRAGMA foreign_keys = ON` 已在 `openDatabase` 打开）。
- [ ] 提交**之后**调用 `runtime.deleteThread(canvasId)`；它抛错时不回滚删除，返回仍然是 `204`，并记一条 `codex-runtime/thread_delete_failed`（`warn`）。
- [ ] 删除后再 `GET /paint/canvas/:id` 返回 404。
- [ ] 删除一个**正在被当前浏览器打开**的画布不影响服务端其他行为；前端在票 04 处理跳转。
- [ ] daemon 集成测试覆盖：204、级联行数归零、404、`deleteThread` 抛错时仍 204。

## Notes

- `deleteThread(canvasId)` 已实现（`codex-runtime.ts:1314-1343`）但从未被路由调用；本票是接线。
- 若运行时的 `deleteThread` 在无 thread 时是 no-op，保持现状（它会记 `thread_delete_skipped`）。
- 不做软删除、不做回收站。

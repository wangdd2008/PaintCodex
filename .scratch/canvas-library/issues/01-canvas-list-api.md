# 01: 画布列表接口 `GET /paint/canvas`

**What to build:** 服务端的集合读取：分页、排序、图层数、缩略图标记。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

**Covers:** 画布库 §1

**Size:** S

## Acceptance Criteria

- [ ] `GET /paint/canvas?limit=&offset=&sort=` 返回 `{ items, total, limit, offset }`，`items` 元素为 `CanvasSummary`：`id`、`name`、`width`、`height`、`backgroundColor`、`layerCount`、`revision`、`hasThumbnail`、`thumbnailRevision`、`createdAt`、`updatedAt`。
- [ ] `sort` 只接受 `updated`（默认，`updatedAt DESC`）与 `created`（`createdAt DESC`）；其他值 `400 invalid_query`。
- [ ] `limit` 1–100（默认 50）；`offset` ≥ 0；越界或非整数 `400`。
- [ ] `layerCount` 与真实图层数一致（子查询，不 N+1）。
- [ ] 空库返回 `items: []`、`total: 0`、`200`。
- [ ] `total` 是不受分页影响的画布总数。
- [ ] 列表**不**返回缩略图字节，只返回 `hasThumbnail` / `thumbnailRevision`。
- [ ] 契约类型进 `packages/protocol`（`CanvasSummary`、`CanvasListPage`），前端不重新声明。

## Notes

- 新增 `CanvasRepository.list({ limit, offset, sort })` 与 `count()`。
- `hasThumbnail` 通过 `LEFT JOIN canvas_thumbnails` 得到；票 03 落地前该表可能不存在，查询要用 `CREATE TABLE IF NOT EXISTS` 保证顺序无关。
- 不做时间范围、搜索、标签。

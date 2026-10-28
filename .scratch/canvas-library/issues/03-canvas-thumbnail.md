# 03: 缩略图：懒生成、独立存储

**What to build:** 画布被打开时由浏览器渲染 320×180 并上传；列表只标记有无。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

**Covers:** 画布库 §4

**Size:** M

## Acceptance Criteria

- [ ] 新表 `canvas_thumbnails(canvasId PK, revision, width, height, bytes BLOB, updatedAt, FK → canvases ON DELETE CASCADE)`，用 `CREATE TABLE IF NOT EXISTS` 建立，不改 `canvases` 列。
- [ ] `PUT /paint/canvas/:id/thumbnail`，body `{ imageUrl, revision }`：成功 `204`；非 `data:image/png;base64,`、解码后 > 256 KB、`revision` 非整数 → `400 invalid_thumbnail`；画布不存在 → `404 canvas_not_found`。
- [ ] `GET /paint/canvas/:id/thumbnail`：有图 `200 image/png` + `Cache-Control: no-store`；无图 `404 thumbnail_not_found`。
- [ ] 前端在画布就绪、无在途 mutation、距最后一次变更 ≥ 800 ms 时渲染一次；`thumbnailRevision === canvas.revision` 时跳过。
- [ ] 上传失败静默（`debug`），不产生用户可见错误，不影响画画与保存状态。
- [ ] 切换画布/刷新不会重复上传同一个 revision。
- [ ] 输出尺寸固定 320×180（按文档比例裁剪或留白，二选一写死并在注释里说明）。

## Notes

- 渲染走 Fabric 现有的 `toDataURL({ multiplier })`；不要新开离屏画布。
- 阈值与尺寸放在前端常量里，不要让服务端决定渲染参数。
- daemon 没有渲染器，所以「从没打开过的画布没有缩略图」是设计而非缺陷；列表用背景色块 + 名称首字占位。

# 04: 画布身份：新建确认、返回上一张、重命名

**What to build:** 画布从「一个匿名文档」变成「有名字、能回去的文档」：新建前确认、失败不覆盖当前画布、可一次操作回到上一张、可重命名，并新增只接受 `name` 的 `PATCH /paint/canvas/:id`。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

**Covers:** UX-05, UX-06

**Size:** M

## Acceptance Criteria

- [ ] 有画布时点击「新建画布」先弹确认；取消后 URL、localStorage、当前画布内容均不变。
- [ ] 确认新建后，可一次操作（1 次点击）回到上一张画布，其图层与修订号完整。
- [ ] 新建失败时当前画布仍可用，URL 与 localStorage 不被覆盖（现状是 `replaceState` 先覆盖再失败）。
- [ ] `history.back()` 不再离开应用。
- [ ] 新增 `PATCH /paint/canvas/:id`：只接受 `name`（trim 后 1–80 字符，否则 `400`）；传 `width`/`height`/其他字段返回 `400`；不存在返回 `404`；响应形状与 `GET /paint/canvas/:id` 一致。
- [ ] `POST /paint/canvas` 对 `name` 施加同一套校验：非字符串、空串、超长返回 `400`，不再出现 `500`。
- [ ] 新建画布默认名 `未命名 YYYY-MM-DD HH:mm`。
- [ ] 行内重命名：双击名字或点小按钮进入，Enter 或失焦提交，Esc 取消，空值回退原名；提交失败回滚并就地提示。
- [ ] 改名后菜单栏、导出文件名、刷新后都使用新名。
- [ ] 键盘可完成重命名全流程，输入框有中文 `aria-label`。
- [ ] 自动化：daemon 集成测试覆盖 `PATCH` 的 200/400（含非法字段）/404；前端测试覆盖 Esc 不产生 PATCH。

## Notes

- 不做画布列表；`previousCanvasId` 单级返回足够解决误触。
- 重命名是「画布身份」的根：所有画布同名导致导出互覆、返回上一张时无法辨认。先把身份做出来，命名与导出文件名的细节在票 05。

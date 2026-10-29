# 04: 画布库视图与路由历史

**What to build:** `?page=canvases` 的画布库：卡片网格、打开、重命名、删除、空状态；进入画布 `pushState`，后退回库。

**Blocked by:** 01（列表接口）。02/03 落地后再接删除与缩略图。

**Status:** done

**Covers:** 画布库 §2、§5

**Size:** L

## Acceptance Criteria

- [x] `AppView` 扩成 `'canvas' | 'canvases' | 'monitor'`；`?page=canvases` 渲染库，`?page=monitor` 渲染监控，其余渲染画布。
- [x] 菜单栏出现「画布库」入口；从库点卡片打开画布时 `history.pushState` 到带 `canvasId` 的画布 URL。
- [x] 浏览器后退从画布回到库；`popstate` 落在画布视图且 `canvasId` 与当前不同时 `loadCanvas`；id 缺失或 404 时跳库。
- [x] 新建画布成功后用 `replaceState`（历史里不留中间态），并跳到新画布。
- [x] 卡片显示：缩略图（没有则背景色块 + 名称首字）、名称、`宽 × 高 · N 层`、相对更新时间。
- [x] 卡片是真实链接（`<a href>`），可 Tab、可 Enter 打开；整卡可点。
- [x] 行内重命名复用现有 `PATCH /paint/canvas/:id` 的交互规范（双击/✎ 进入，Enter/失焦提交，Esc 取消，空值回退）。
- [x] 删除走二次确认，确认文案包含画布名与「不可恢复」；删除当前打开的画布后跳到库；删除失败就地提示且卡片保留。
- [x] 空库显示主 CTA「新建画布」。
- [x] 首页加载超过 50 张时显示「加载更多」，点击追加一页；不引入虚拟滚动。
- [x] 组件测试覆盖：后退回库、删除确认取消不发请求、空库 CTA。

## Notes

- 库不订阅 SSE；进入时拉一次列表。
- 与票 06 一起收尾：「返回上一张」和新建确认条在同一轮删除，避免出现两套返回路径。


## Comments

- 2026-10-29 · 实现完成：`744242e`，合入 integration 分支 `feat/canvas-library-workspace-monitor`（merge `5f2b09a`）；经 code-review 双轴复查与统一修复（`4475df8`/`bdcc10a`）后验收全部满足，关闭。

# 04: 画布身份：新建确认、返回上一张、重命名

**What to build:** 画布从「一个匿名文档」变成「有名字、能回去的文档」：新建前确认、失败不覆盖当前画布、可一次操作回到上一张、可重命名，并新增只接受 `name` 的 `PATCH /paint/canvas/:id`。

**Blocked by:** None (can start immediately)

**Status:** done

**Covers:** UX-05, UX-06

**Size:** M

## Acceptance Criteria

- [x] 有画布时点击「新建画布」先弹确认；取消后 URL、localStorage、当前画布内容均不变。
- [x] 确认新建后，可一次操作（1 次点击）回到上一张画布，其图层与修订号完整。
- [x] 新建失败时当前画布仍可用，URL 与 localStorage 不被覆盖（现状是 `replaceState` 先覆盖再失败）。
- [ ] `history.back()` 不再离开应用。—— 见 Comments「关于 history.back」：本票按 spec §6 走 `previousCanvasId`，不调用 `history.back()`、也不为画布切换新增历史条目，返回入口由「返回上一张」承担；字面拦截浏览器后退需引入 `pushState` + `popstate` 路由，与 §6 冲突，未实现，留待决策。
- [x] 新增 `PATCH /paint/canvas/:id`：只接受 `name`（trim 后 1–80 字符，否则 `400`）；传 `width`/`height`/其他字段返回 `400`；不存在返回 `404`；响应形状与 `GET /paint/canvas/:id` 一致。
- [x] `POST /paint/canvas` 对 `name` 施加同一套校验：非字符串、空串、超长返回 `400`，不再出现 `500`。
- [x] 新建画布默认名 `未命名 YYYY-MM-DD HH:mm`。
- [x] 行内重命名：双击名字或点小按钮进入，Enter 或失焦提交，Esc 取消，空值回退原名；提交失败回滚并就地提示。
- [x] 改名后菜单栏、导出文件名、刷新后都使用新名。
- [x] 键盘可完成重命名全流程，输入框有中文 `aria-label`。
- [x] 自动化：daemon 集成测试覆盖 `PATCH` 的 200/400（含非法字段）/404；前端测试覆盖 Esc 不产生 PATCH。

## Notes

- 不做画布列表；`previousCanvasId` 单级返回足够解决误触。
- 重命名是「画布身份」的根：所有画布同名导致导出互覆、返回上一张时无法辨认。先把身份做出来，命名与导出文件名的细节在票 05。

## Comments

### 2026-10-26 · 实现

**提交：** `05a786c`（票更新见本提交）。基线 `be23d3f`，开工前 `git merge feat/release-hardening --no-edit` 为 up-to-date。

**改动文件**

- daemon：`src/api/routes.paint.ts`（PATCH 路由 + 名称校验）、`src/paint/service.ts`（`renameCanvas`、`defaultCanvasName`）、`src/paint/repository.ts`（`CanvasRepository.rename`）、`src/paint/command-dispatcher.ts`、`test/canvas.test.ts`（默认名）、`test/canvas-identity.test.ts`（新增）
- web：`src/services/api.ts`（`renameCanvas`）、`src/services/canvas-store.ts`（`previousCanvasId`、`returnToPreviousCanvas`、`renameCanvas`、新建失败不覆盖）、`src/features/canvas/CanvasNameEditor.tsx` + `canvas-name.css`（新增）、`src/features/canvas/NewCanvasConfirm.tsx`（新增）、`src/app/App.tsx`、`src/app/app.css`、`test/canvas-identity.test.tsx`（新增）
- protocol：`MAX_CANVAS_NAME_LENGTH = 80`、`UpdateCanvasRequest`（前后端共用同一个长度上限，避免漂移）

**PATCH 契约**

```
PATCH /paint/canvas/:id
body: {"name": string}          // 只接受 name；trim 后 1–80 字符
200  → CanvasDocument           // 与 GET /paint/canvas/:id 同形（含 layers、history）
400  → {"error":{"code":"invalid_canvas","message":"…"}}
       // 缺 name、空名、纯空白、非字符串、超长、width/height/backgroundColor/revision 等任何其他字段
404  → {"error":{"code":"canvas_not_found","message":"画布不存在"}}
副作用：只写 name 与 updatedAt；不推进 revision、不写快照、不发 SSE
```

不推进 revision 是刻意的：改名是身份而不是内容，若推进 revision，会截断重做栈（`prepareHistory` 的 `truncateAfter`）并让在途笔画的 `expectedRevision` 撞 409。代价是其他标签页要等下一次刷新才看到新名（本轮不做画布级别的跨标签同步）。

**实现要点**

- 新建：先 `POST` 成功，再 `rememberCanvas`；失败时保留 `canvas`/`requestedCanvasId`/状态 `ready`，只有错误文案变化。有画布时「新建画布」打开画布区顶部确认条（`role="alertdialog"`，焦点默认在「取消」，Esc 关闭），确认后按钮转「新建中…」，失败仍停在原画布。
- 返回上一张：`previousCanvasId` 单级、内存态（刷新即失效，符合「不做列表」）；成功返回后清空；返回请求失败保留当前画布与指针，404 时提示「上一张画布不存在」并清空指针。
- 重命名：菜单栏名字双击或 ✎ 进入（✎ 是 Tab 可达的真实按钮，Enter/Space 打开）；Enter/失焦提交，Esc 取消（`stopPropagation`，不会顺带关闭侧栏抽屉），空值回退原名且不发请求；显示名只来自服务端响应，失败时回滚并就地 `role="alert"` 提示；输入框 `aria-label="画布名称"` + `maxLength=80`。`PATCH` 走与笔画相同的 mutation 队列（但不改保存状态），避免改名响应比在途笔画更晚落地、用旧快照盖掉刚画的图层。
- 改名后的传播：菜单栏（`CanvasNameEditor`）、画布下方 hint（`CanvasStage` 读 `canvas.name`）、导出 PNG/JSON 文件名（`canvasPngFilename` / `canvasJsonFilename` 读 `canvas.name`）、刷新（daemon 已持久化）自动一致，无需额外同步。

**测试数字**

- 实现提交 `05a786c` 时：`pnpm --filter @paintcodex/daemon test` **132 passed / 18 files**（新增 `canvas-identity.test.ts` 21 条：POST 名称校验 7、PATCH 14）；`pnpm --filter @paintcodex/web test` **109 passed / 12 files**（新增 `canvas-identity.test.tsx` 7 条）；`pnpm -r typecheck` 通过（protocol / daemon / web 三包）。
- 合并集成分支后复跑：第一次合并（含 02/08/15）后 web **146 passed / 20 files**；第二次合并（含 11/13）后 web **156 passed / 22 files**。daemon 两次合并都未改动，仍为 **132 passed / 18 files**。`pnpm -r typecheck` 两次均通过。

**合并集成分支**

开工时 `feat/release-hardening` 是 `be23d3f`（含 01/03/06/07/14）。收尾期间集成分支又前进了两次：`747a2c3`（并入 02、08、15）与 `6e7e7b7`（并入 11、13），两次都在本分支合并（`258cf92`、`06bb111`）。`apps/web/src/app/App.tsx`、`apps/web/src/app/app.css` 自动合并成功；唯一冲突在 `apps/web/src/services/canvas-store.ts` 的 `createNewCanvas` 起始 `set`，解决为同时保留 `const previous = get().canvas`（本票，用于 `previousCanvasId`）与 `...resetSaveState()`（02 的保存状态）；`returnToPreviousCanvas` 也补了 `...resetSaveState()`，避免切换画布后残留上一张的「已保存」状态。合并后 `SaveStatus`、`ConnectionStatus`、`返回上一张`、`CanvasNameEditor`、`NewCanvasConfirm` 在 `App.tsx` 与状态栏里共存，无需进一步改动；第二次合并没有代码冲突。

**关于 `history.back()`**

本票没有拦截浏览器后退。`rememberCanvas` 仍是 `replaceState`，新建/返回都不新增历史条目，代码里也没有任何 `history.back()` 调用；因此不存在「后退到旧 URL 却是新画布」这种不一致，返回上一张也不依赖浏览器历史。但直接打开应用时按后退仍会回到进入前的页面（浏览器行为，基线同样如此）。要字面做到「后退不离开应用」，需要新建时 `pushState` 并在 `popstate` 里按 URL 的 `canvasId` 重新加载——即 spec §6 明确排除的方案 B。已在验收里保留未勾选，交产品决策（若采纳，改 `rememberCanvas` 一处 + `App` 的 `popstate` 处理即可）。

**未做（属其他票）**

- 画布列表/画廊、`previousCanvasId` 持久化（超出 spec §6）。
- 图层命名规则（`Stroke N` → 唯一编号/中文）与导出文件名补时间戳：票 05。
- 30 秒自动下载、保存状态、全局错误横幅：票 02（合并时 02 已落地，本票未改它们的逻辑）。本票在 `App.tsx` 只新增 `CanvasNameEditor`、`NewCanvasConfirm`、「返回上一张」和 `confirmNewCanvas` 状态。

**须浏览器人工复核**

1. 390×844：菜单换行后「返回上一张」「新建画布」仍可点；确认条不压住画布关键区域；≤860px 时名字文本按既有窄屏规则隐藏，只剩 ✎（编辑框仍可打开）。
2. 双击名字进入编辑；Tab 到 ✎ 按 Enter 进入编辑；编辑中按 Esc 只取消改名，不关闭侧栏抽屉。
3. 停掉 daemon 后改名：名字回滚、菜单栏就地红字提示，画布仍可继续画。
4. 改名后刷新页面：新名仍在；导出 PNG / JSON 的文件名使用新名。
5. 浏览器后退（见上一节）：A 有内容 → 新建 B → 按后退，确认与上文描述一致（仍离开应用，属基线行为，不是本票回归）。
6. 读屏：确认条 `role="alertdialog"`、焦点落在「取消」；重命名按钮与输入框的中文名称可读。

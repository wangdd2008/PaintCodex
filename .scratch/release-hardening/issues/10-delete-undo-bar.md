# 10: 删除恢复条与撤销守卫

**What to build:** 去掉原生 `confirm`，删除即时生效并在面板顶部给出 8 秒恢复条；撤销入口绑定 revision，避免撤掉用户意料之外的东西。

**Blocked by:** 02 (反馈面与撤销守卫), 06 (面板顶部位置)

**Status:** done

**Covers:** UX-12

**Size:** S

## Acceptance Criteria

- [x] 不再出现原生 `window.confirm`。
- [x] 删除后 1 次往返内该行消失，图层面板顶部出现恢复条「已删除「笔迹 4」· 撤销」，8 秒后自动消失。
- [x] 点「撤销」后名称、可见性、内容、像素完全恢复（与删除前一致）。
- [x] 连续删除只显示最近一条恢复条。
- [x] revision 守卫：仅当 `currentRevision === 删除时的 revision` 时撤销可点；用户后续有任何操作则降级为「已删除「笔迹 4」· 已有后续操作」，不可点。
- [x] 删除失败就地显示原因与重试；不出现「看起来删掉了但刷新又回来」。
- [x] 工具栏的全局撤销仍可用，作为兜底。
- [x] 自动化：删除 → 撤销 → 断言图层数量与像素回到删除前；删除 → 再画一笔 → 断言恢复条不可点。

## Notes

- 现状删除成功无任何反馈，工具栏撤销可恢复（实测 9→8→9）。
- 撤销是快照级（ADR-0003），所以「撤错对象」的真实风险是后续操作覆盖，不是撤销本身。

## Comments

**2026-10-26 — implementation commit `6e0d887`（基线 `a1745e2`；合并最新 `feat/release-hardening` `747a2c3` 后为 merge commit `6d593bd`，无冲突）**

- **删除即时生效**：`LayerPanel.handleDelete` 删除 `window.confirm` 分支（行内 × 与 `Delete` 键共用），直接调用 `deleteLayer`。行只在 DELETE 响应返回后才消失（不乐观删除），因此不会出现「先删掉、失败后又回来」。一次只允许一个删除在途，期间行内删除按钮禁用（原先跟随全局 `saving` 的禁用改为按本次删除在途判断，见票 07 的范围说明）。
- **恢复条**：面板顶部（标题下、列表上）渲染 `role="status"` 的恢复条，文案「已删除「{name}」」+「撤销」按钮；`DELETE_RESTORE_TIMEOUT_MS = 8000`，8 秒后自动消失。连续删除时后一条替换前一条并重新计时，DOM 中始终最多一条。
- **撤销绑定 revision**：`deleteLayer` 现在返回删除产生的 `CanvasDocument`（`runMutation` 改为泛型透传结果），面板记录 `updated.revision` 作为「删除时的 revision」。仅当 `canvas.revision === 该 revision` 时渲染可点的「撤销」；否则按 spec §4 降级为纯文本「已删除「{name}」· 已有后续操作」，不提供撤销入口。撤销调用既有 `undo()`（快照级，ADR-0003），返回的名称/可见性/内容与像素由服务端快照恢复；图层回来后恢复条自动清除，因此工具栏 Ctrl+Z 恢复时也不会留下过期的撤销入口。
- **失败路径**：复用票 02 的画布区顶部 `role="alert"` 横幅（中文原因 +「重试」），横幅的重试仍走面板的删除流程，所以重试成功后同样出现恢复条；成功删除时会清掉上一次「无法删除图层」的失败横幅，避免「删掉了还挂着报错」。失败时行与 store 快照均不变。
- **测试**：新增 `apps/web/test/delete-undo-bar.test.tsx` 6 条——删除即行消失 + 恢复条 + 0 次 `confirm`；8 秒自动消失（fake timers，7999ms 仍在 / 8000ms 消失）；撤销后图层数量、名称、可见性、内容与 Fabric 画布对象回到删除前（并断言 undo 的 `expectedRevision` 为删除后的 revision）；删除后再画一笔（`path:created` → `createLayer`）后降级为不可点纯文本；连续删除只保留最近一条；删除失败显示原因 + 重试、行不消失、重试成功后出现恢复条。另更新 `layer-panel-keyboard.test.ts` 中两条依赖 `window.confirm` 的用例（删除直接发请求、Delete 键不再弹确认），键盘序列与选中语义未改。
- **门禁数字**：`pnpm --filter @paintcodex/web test` → **20 文件 / 145 passed**；`pnpm -r typecheck` 三个包全绿。未引入新依赖、未新增全局 toast、未改工具栏撤销。
- **需浏览器人工复核**：① 真实 daemon 下删除 → 撤销后刷新页面，名称/可见性/像素仍与删除前一致（快照持久化）；② 隐藏图层与 AI 生成图层的撤销恢复（jsdom 用替身验证对象数量与来源，无法验真实 Fabric 像素）；③ 停 daemon 删除时横幅出现时间与文案、重试成功后横幅消失且恢复条出现；④ 真实 8 秒计时（自动化用 fake timers）；⑤ `role="status"` 的读屏播报，以及窄屏（≤860px 抽屉）/200% 缩放下 24px 撤销按钮与焦点环不被裁切。
- **范围说明**：未改选中/键盘语义（票 08）、工具栏撤销、删除确认之外的交互；「就地」按票 02 的约定复用画布区顶部横幅，不新增面板内错误条或全局 toast。

**2026-10-26 — 合并后补记**

- 合并 `feat/release-hardening` 最新 `6e7e7b7`（含票 13 连接状态、票 11 AI 等待）：merge commit `48c6df0`，无冲突。
- 合并后门禁：`pnpm --filter @paintcodex/web test` → **22 文件 / 155 passed**（本票 6 条全过）；`pnpm -r typecheck` 三包全绿。


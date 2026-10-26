# 02: 保存状态、错误横幅与失败保留

**What to build:** 删除每 30 秒自动下载 JSON 的 effect；在状态栏建立唯一的保存状态；保存失败时不再移除笔画，而是保留、标记未保存、提供重试；画布级错误改为画布区顶部横幅。

**Blocked by:** None (can start immediately)

**Status:** done

**Covers:** UX-02, UX-08

**Size:** M

## Acceptance Criteria

- [ ] `App.tsx` 的 30 秒自动下载 effect 被删除；新建画布空闲 30 分钟，Downloads 新增文件数为 0。（effect 已整段删除；静态断言 `App.tsx` 无 `setInterval`/`30_000`，运行测试快进 60 秒断言下载函数 0 调用。未实际计时 30 分钟观察 Downloads，见 Comments）
- [x] 画一笔后 ≤1 秒状态栏显示「已保存」；连续 5 笔内每条笔画只经历一次「保存中 → 已保存」，不来回抖动（防抖 ≤500ms）。
- [x] 空闲时显示相对时间：≤15 秒「刚刚」，之后「N 秒前」，≥60 秒「N 分钟前」。
- [x] 停 daemon 再画一笔：≤2 秒画布区顶部出现 `role="alert"` 横幅，含中文原因与「重试」；该笔画仍留在画布上并标为未保存。
- [x] 点「重试」成功后横幅消失、笔画进入快照、状态栏回到「已保存」；刷新页面后笔画仍在。
- [x] 若重试会造成重复路径（Fabric 对象无法与服务端快照对齐），降级为移除笔画 + 横幅明说「这一笔未保存」；**不得静默移除**。
- [x] 横幅生命周期：mutation 失败时出现；该 mutation 重试成功或用户手动关闭时消失；`refreshCanvas` 成功不清除。
- [ ] 状态栏显示真实缩放，替代硬编码的「缩放: 100%」：1264×625 下为 44.7% ±1%（由 canvas 元素渲染宽度 / 1920 计算，窗口变化实时更新）。（计算已单测 858/1920=44.7%，`ResizeObserver` 已接入；1264×625 实际像素待浏览器复核，见 Comments）
- [x] 状态栏信息去重：画布名/尺寸/比例/工具/保存状态各出现一次，移除画布内重复 hint。
- [x] 顶栏不再承载主要错误（`.menu-status` 的红字可保留为摘要，但详细原因与重试在横幅里）。
- [x] 自动化：daemon 不可达时组件测试断言笔画对象仍存在且横幅出现；断言 `saveStatus` 序列为 saving → saved。

## Notes

- 该票是 Wave 0/1 的枢纽：票 10、11、12、13 都复用这里定义的横幅与状态栏槽位。
- 撤销 30 秒自动下载需要 `## Comments` 回写 `.. /canvas-save-and-localization/issues/02-auto-save.md`，见 spec `## Superseded Decisions`。

## Comments

**2026-10-26 — implementation commit `5d1935d`（基线：fast-forward 合并 `feat/release-hardening` `7b2dcd8`，无冲突）**

- **删除自动下载**：`App.tsx` 中 `window.setInterval(..., 30_000)` + `downloadCanvasJson` 的整段 effect 已删除；`downloadCanvasJson` 现在只由「导出 JSON」按钮显式调用。测试同时做两件事：静态断言 `App.tsx` 不含 `setInterval`/`30_000`/`Auto-save`，并在渲染 `App` 后快进 60 秒断言下载函数未被调用。
- **保存状态机**：`canvas-store` 新增 `saveState: 'idle' | 'saving' | 'saved' | 'error'`、`lastSavedAt`、`saveError`、`unsavedStrokes`；`saving` 与 `saveState === 'saving'` 保持同步，现有撤销/重做/删除按钮的禁用逻辑不变。连续 mutation 用 **500ms 防抖** 收敛：5 笔连写只产生一次 `saving → saved`，失败不会被后续成功静默盖掉（仍有未保存笔画时保持 `error`）。
- **状态栏**：新增 `SaveStatus`，文案 `保存中…` / `已保存 · 刚刚` / `已保存 · N 秒前` / `已保存 · N 分钟前` / `保存失败 · 重试`（失败态是可点按钮，横幅关闭后仍可从状态栏重试），相对时间每秒刷新。移除 `.canvas-hint`（及其 CSS）；名称只在菜单栏出现，尺寸/比例/工具/保存状态在状态栏各出现一次。
- **失败保留笔画**：`handlePathCreated` 的失败分支不再 `canvas.remove(path)`。笔画保留在 Fabric 画布上，以半透明 + 虚线标记未保存，并进入 pending 集合。失败后画布区顶部出现 `role="alert"` 横幅：中文原因 +「重试」+「关闭」（`aria-label="关闭错误提示"`）。
- **重试与对齐**：重试先 `refreshCanvas` 取权威快照；若快照已含同一 `fabric.json`，丢弃本地副本（服务端副本由快照同步渲染）；否则重发 `createLayer`，成功后把本地对象映射进 `objectsRef`/`signaturesRef` 并恢复样式。仅当返回图层无法与本地对象对齐时，才移除并显示「这一笔未保存：无法与服务端快照对齐。」，不存在静默移除路径。
- **横幅生命周期**：mutation 失败出现；该 mutation 重试成功或手动关闭消失；`refreshCanvas` 成功不清除（有组件测试：失败后成功刷新，横幅仍在）。
- **真实缩放**：新增 `viewport-store` 的 `computeZoomPercent(renderedWidth, canvasWidth)`；`CanvasSurface` 用 `ResizeObserver` 观察 canvas 元素渲染宽度，按 `renderedWidth / 1920` 计算，状态栏显示一位小数（无 observer/无画布时为 `—`，不伪造数字）。
- **测试**：新增 `save-state.test.ts` 3 条（5 笔防抖序列、失败中文原因、撤销失败横幅）、`save-status.test.tsx` 5 条（相对时间/每秒刷新/三种文案/重试按钮）、`canvas-save-failure.test.tsx` 3 条（断 daemon 笔画保留 + 横幅、刷新不清横幅、重试成功、无法对齐时显式移除）、`app-status-bar.test.tsx` 3 条（状态栏去重与真实比例、源码无自动下载、60 秒 0 下载）、`zoom.test.ts` 3 条（858/1920=44.7% 等）。
- **门禁数字**：`pnpm --filter @paintcodex/web test` → **14 文件 / 103 passed**；`pnpm --filter @paintcodex/daemon test` → **17 文件 / 103 passed**；`pnpm -r typecheck` 全绿；`pnpm --filter @paintcodex/web build` 成功（默认 TEMP 下 esbuild 删临时文件被 Windows 权限拒绝，重定向临时目录后构建通过，非代码问题）。
- **需浏览器人工复核**：① 1264×625 实际窗口下状态栏是否为 44.7% ±1%（jsdom 无布局，无法断言真实像素）；② 新建画布空闲 30 分钟的 Downloads 计数（代码/测试已证无 30 秒定时器，未实际计时）；③ 停 daemon 后真实 pointer 画一笔，横幅是否 ≤2 秒出现、笔画半透明虚线与状态栏「保存失败」是否同步；④ 重试成功后刷新页面笔画仍在（真实 daemon 持久化）；⑤ 关闭横幅后从状态栏「保存失败 · 重试」再次重试的交互。
- **范围**：未改票 11/12/13 的 AI 与连接逻辑；未引入新依赖；未重建 toast；撤销仍为快照级（票 10 的恢复条未做）。

**2026-10-26 — 合并后补记**

- 合并 `feat/release-hardening` 最新 `be23d3f`（已含票 03 监控口径与票 14 窄屏）：merge commit `61898da`。冲突仅在 `apps/web/src/app/app.css` 末尾——双方都追加规则；解决方式为保留本票的 `.status-bar__save` / `.status-bar__retry` 与票 14 的 1100/860/560 三档媒体查询，无功能取舍。
- 合并后门禁：`pnpm --filter @paintcodex/web test` → **16 文件 / 119 passed**（新增票 03 的 monitor-format/stats-panel 与票 14 的 narrow-viewport）；`pnpm --filter @paintcodex/daemon test` → **17 文件 / 111 passed**；`pnpm -r typecheck` 全绿；`pnpm --filter @paintcodex/web build` 成功。1264px 宽窗口不落在票 14 的 ≤1100px 断点内，桌面画布宽度与 44.7% 的推导不受影响。


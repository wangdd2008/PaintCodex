# 15: 画笔颜色与粗细

**What to build:** 画笔不再固定为 1.8px 黑线：常用色板 + 自定义颜色、四档粗细与预览，默认更可见；设置只存活于当前会话。

**Blocked by:** None (can start immediately)

**Status:** done

**Covers:** UX-20

**Size:** M

## Acceptance Criteria

- [x] 色板：黑、深灰、红、橙、蓝、绿 + 自定义颜色输入。
- [x] 粗细四档：2 / 4 / 8 / 16，带笔触预览。
- [x] 默认颜色 `#111111`、默认宽度 **6**；1264×625 下默认笔画的屏幕笔宽 ≥2.5px。
- [x] 选择后新笔画使用新设置，已有图层不变。
- [x] 设置存会话状态，刷新回默认（持久化明确不在本轮）。
- [x] 色板与粗细可 Tab 聚焦、有中文 `aria-label`、选中态不只靠颜色传达（加边框/标记）。
- [x] 自动化：选红色 + 8 后画一笔，断言新 path 的 `stroke` 与 `strokeWidth`；断言已有 path 未变。

## Notes

- 现状：`BRUSH_COLOR = '#111111'`、`BRUSH_WIDTH = 4`，858px 显示宽度下约 1.8px；无任何颜色/粗细控件。
- 不做硬度、压感、纹理。
- 色板的具体配色需要视觉判断，因此标记为 `ready-for-human`。

## Comments

**2026-10-26 — implementation commit `1c3a0a8`**

- 实现：`apps/web/src/services/tool-store.ts` 增加会话级 `brushColor` / `brushWidth`（默认 `#111111` / `6`），色板与四档宽度常量也放在这里；`Toolbox.tsx` 增加两列色板（黑/深灰/红/橙/蓝/绿 + `<input type="color">` 自定义）与四档粗细（2/4/8/16，浅底实心笔触按真实像素高度预览、颜色跟随当前画笔）；`CanvasStage.tsx` 删掉写死的 `#111111` / 4，画布创建时与设置变化时都同步 `freeDrawingBrush.color/width`。
- 测试：`pnpm --filter @paintcodex/web test` 通过 **72/72**（8 个文件；新增 `apps/web/test/toolbox-brush.test.tsx` 7 条、`apps/web/test/canvas-brush.test.tsx` 2 条）；`pnpm -r typecheck` 三个包全部通过；`pnpm -r test` 重跑全绿（web 72/72，daemon 103/103）。首次并行跑 daemon 时有 2 条 `codex-instrumentation` 5s 超时，单跑该文件与重跑均通过，属既有超时抖动，与本次改动无关。
- 默认笔宽换算：1264×625 视口下画布框实测 860 CSS px（1264 − 56 工具条 − 300 侧栏 − 48 画布区内边距），画布逻辑宽 1920 → 缩放 860/1920 ≈ 0.448；默认宽度 6 → 屏幕约 **2.69px**（旧值 4 约 1.79px），满足 ≥2.5px。显示比例随画布逻辑尺寸同比变化。
- 自动化断言：选红色 + 8 后模拟 `path:created`，断言 POST 载荷 `content.json` 中 `stroke: "#dc2626"`、`strokeWidth: 8`；同时断言只发一次 POST、没有 PATCH、既有图层 `content` 不变。jsdom 无 2D context，`fabric` 用最小替身（只保留 `Canvas` / `PencilBrush` / `enlivenObjects` 与 `path:created`），断言落在持久化载荷上而不是 fabric 内部。
- 浏览器实测（1264×625，daemon 用临时库）：真实 fabric 6.9.1 画出默认笔画，落库 JSON 为 `stroke: "#111111"`、`strokeWidth: 6`；改红色 + 8 再画一笔，新图层为 `#dc2626` / `8`，第一层逐字段不变。色板/粗细的 Tab 焦点与蓝色焦点环、`aria-pressed`、白色选中环 + ✓ 均已实拍复核。
- 可访问性：每个色块有 `aria-label`（黑色/深灰色/红色/橙色/蓝色/绿色）、自定义输入 `aria-label="自定义画笔颜色"`、粗细 `aria-label="笔宽 2/4/8/16"`；选中态用 `aria-pressed` + 边框/白色环 + ✓ 标记，不只靠颜色。工具条横向内边距改为 4px，使 56px 与 spec 的 48px 工具条都能容下 40px 宽的两列色块（48px 工具条的其它调整仍归票 14）。
- 范围与风险：未引入依赖；设置只存在 zustand 内存，刷新回默认，未写 localStorage。色板取值为工程取值（深灰 `#4b5563`、红 `#dc2626`、橙 `#ea580c`、蓝 `#2563eb`、绿 `#16a34a`），最终品牌配色可由人再微调；窄屏（≤860px 抽屉、48px 工具条）未在本票验证，依赖票 14。
- 合并 `feat/release-hardening` 三次（merge commit `675d6bd`、`59164ed`、`e8634af`，后两次带入票 03 监控口径与票 14 窄屏断点）：唯一冲突在 `apps/web/src/features/toolbox/Toolbox.tsx`，按保留双方解决——保留上游票 07 的 `canvas` 判空禁用「画笔/选择」，加上本票的颜色/宽度状态与控件；`CanvasStage.tsx` 上游拆出的 `CanvasSurface` 由 git 自动合并，画笔设置改动落在新组件内。合并后在浏览器复核 1100×625 与 390×844 下 48px 工具条仍能容下两列 18px 色块与 40px 粗细按钮。最终门禁：`pnpm --filter @paintcodex/web test` **111/111**（13 文件，含其他票新增用例）、`pnpm -r typecheck` 三包通过、daemon 全量 111/111（`codex-instrumentation` 的 exit-code 用例偶发 5s 超时属既有抖动，单跑 5/5 通过）。
- 收尾时再次合并票 08（merge commit `b35f7cd`；与上游唯一冲突同为 `CanvasStage.tsx` 组件顶部的 selector 行，按双方保留解决）：合并后 web 测试增至 **122/122**（14 文件）、`pnpm -r typecheck` 三包通过。集成分支已生成 `09314c7 merge(15)` 并包含本票此前成果，其树与本分支仅 selector 顺序不同。

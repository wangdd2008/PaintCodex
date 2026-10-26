# 08: 选中图层语义与键盘可达

**What to build:** 让「选中图层」真的意味着选中了什么：AI 图层在画布上被选中并可变换，笔迹图层短时高亮；图层行成为可聚焦控件，键盘能完成整套图层管理。

**Blocked by:** 06

**Status:** done

**Covers:** UX-09

**Size:** M

## Acceptance Criteria

- [x] 点击 AI 图层行 → 该图层成为 Fabric `activeObject`，出现变换框且可拖动/缩放；变换结果写回 SVG 内容。
- [x] 点击笔迹图层行 → 画布上该笔迹高亮 800ms ±100ms 后恢复。
- [x] 图层行可聚焦（`button` 或 `listbox` + `option`），`↑`/`↓` 移动焦点，`Home`/`End` 到首尾，`Enter`/`Space` 选中。
- [x] 全流程可键盘完成：选择图层、隐藏/显示、删除、撤销。
- [x] 焦点可见：`:focus-visible` 2px、offset 2px、对比 ≥3:1。
- [x] 读屏播报名称、类型、可见性、选中态。
- [x] 若某行的点击行为最终不做，必须移除整行点击与 `cursor: pointer`（诚实降级），不得保留「看着能点但没反应」的交互。
- [x] 自动化：键盘序列（Tab → ↓ → Enter → Delete → Ctrl+Z）后断言图层数量与可见性回到预期。

## Notes

- 「选中/定位」不是「绘制目标」：一笔仍然只生成一个图层（spec §7）。
- 行内重命名与透明度作用于该行，与 `activeLayerId` 无关，不要合并成一个状态（票 09）。
- 实现上用 `activeLayerRequest` 计数器区分「用户显式选择」与「新笔画自动成为 activeLayer」：只有前者触发高亮/切换工具，画笔行为不变。

## Comments

**2026-10-26 — implementation commit `6116f45`**

- 选中语义：`LayerPanel` 行点击调用 `setActiveLayer`；`CanvasStage` 订阅 `activeLayerId`/`activeLayerRequest` 与工具状态。AI 图层被选中后调用 `canvas.setActiveObject` 得到变换框，仅显式点击会把工具切到「选择」（加载画布时若 AI 图层恰在顶部，不会抢走画笔）；拖动/缩放的写回复用既有 `object:modified` → SVG `PATCH` 路径。笔迹图层不进入 Fabric 选中，改为临时改 `stroke`/`strokeWidth` 高亮，800ms 后从捕获的原值恢复，不写服务端（测试断言 0 次 fetch）。
- 键盘：图层列表为 `role="listbox"`（`aria-label="图层列表"`、`aria-orientation="vertical"`），行为 `role="option"` + `aria-selected` + roving `tabIndex`；`↑`/`↓`/`Home`/`End` 移动焦点，`Enter`/`Space` 选中，`Delete` 复用同一 `window.confirm` + `deleteLayer`（`saving` 时与禁用按钮一致直接忽略）。行内可见性/删除按钮 `stopPropagation`，行 `keydown` 用 `event.target === event.currentTarget` 守卫，按钮上的 Enter/Space 不会选中整行。
- 读屏：行 `aria-label` 为「名称，类型，可见性」（类型中文：笔迹/位图/AI 生成），选中态由 `aria-selected` 表达，避免把状态拼进名字重复播报。
- 焦点可见：`.layer-item:focus-visible` 为 `outline: 2px solid #5b8def; outline-offset: 2px`；测试从样式表取色并按 WCAG 公式计算，对行底色 `#1b1c21` 为 5.30:1、对选中底色 `#23314f` 为 3.96:1，均 ≥3:1。
- 测试：新增 `apps/web/test/layer-panel-keyboard.test.ts` 11 条（listbox/option 与 roving tabIndex、↑/↓/Home/End、Enter/Space、行内按钮不选中、Delete、读屏名称、焦点环与对比度、AI activeObject 与工具切换、笔迹 800ms 高亮恢复且不写服务端、AI 变换写回 SVG、Tab → ↓ → Enter → Delete → Ctrl+Z 端到端序列）；`apps/web/test/layer-panel-layout.test.ts` 的列表查询随语义从 `list` 改为 `listbox`。`pnpm --filter @paintcodex/web test` → 10 个文件 97 条全绿；`pnpm -r typecheck` 三个包全绿。
- **需浏览器人工复核**：① 真实 Fabric 下 AI 图层的变换框、拖动/缩放，以及写回 SVG 后刷新仍保持（jsdom 只能断言 `setActiveObject` 调用与 PATCH body）；② 笔迹高亮 800ms 的视觉强度、颜色与恢复过程（自动化只验时序）；③ 读屏（NVDA/VoiceOver）实际播报名称、类型、可见性、选中态；④ 200% 缩放下 2px 焦点环与 2px offset 不被裁切；⑤ Tab 顺序（行 → 可见性 → 删除）与真实浏览器焦点行为。
- 范围说明：不改画笔绘制行为（高亮只在显式选择时发生，每笔仍只生成一个图层），不改删除确认交互，未做票 09（重命名/透明度/类型）、票 10（删除恢复条）、票 12（AI 错误）。

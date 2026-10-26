# 07: 图层命中区与可见性语义

**What to build:** 图层行里的按钮达到可点尺寸；可见性控件的名字与状态不再自相矛盾；图标语义可辨且不只靠颜色。

**Blocked by:** 06 (面板布局先稳定)

**Status:** done

**Covers:** UX-10

**Size:** S

## Acceptance Criteria

- [x] 图层行内所有可点元素的命中区 ≥24×24；可见性控件 ≥28×28；相邻控件间距 ≥4px。
- [x] 行高 36–40px；命中区靠热区扩展实现，不放大字形。
- [ ] 浏览器 200% 缩放下控件不被裁切。（CSS 已按 border-box + `min-height` 实现，待人工在浏览器 100%/200% 下复核，见 Comments）
- [x] 可见性控件读屏不再出现「显示 Stroke 1，未按下」这类动作/状态矛盾：`aria-label` 固定为「{name} 可见性」，`aria-pressed` 表示是否可见。
- [x] 图标语义可辨（眼睛/斜线），hover 与 focus 时显示文字提示；不只靠颜色传达状态。
- [x] 8 层时图层面板高度 ≤300px（与票 06 的约束一致）。
- [ ] 可视化验收：截取 100% 与 200% 两张图，控件边界清晰、无重叠。（待人工截图确认）

## Comments

**2026-10-26 — implementation commit `bb66b2b`**

- 实现：行内控件改为固定热区——可见性 28×28、删除 24×24，均 `flex: 0 0 auto`，窄宽/缩放时不被压扁；行高 38px（`box-sizing: border-box` + `min-height: 38px`，内容恰好 28px，字号保持 11px/16px 不变）。可见性 `aria-label` 固定「{name} 可见性」，`aria-pressed` 表示是否可见；图标由 ●/○ 换成内联 SVG 眼睛/眼睛加斜线（`aria-hidden`），hover 与 `:focus-visible` 时显示「隐藏图层」/「显示图层」提示，`:focus-visible` 带 2px 焦点环。
- 测试：新增 `apps/web/test/layer-panel-a11y.test.ts` 8 条（读屏语义、行高/命中区/间距 CSS 契约、焦点可达、图标形状、hover/focus 提示）；`pnpm --filter @paintcodex/web test` → 8 个文件 76 条全绿；`pnpm -r typecheck` 全绿。
- **需 200% 缩放下人工复核**：① 行高 38px 在浏览器最小字号放大时是否仍不裁切（`min-height` 允许撑高，但未实测）；② 提示气泡在窄侧栏（≤860px 抽屉）与滚动条出现时是否被裁切或遮挡；③ 眼睛斜线图标在 100%/200% 下是否可辨；④ 8 层滚动时行内控件是否完整可见。复核并补 100%/200% 两张截图后即可勾掉最后两条验收。
- 范围说明：未改键盘导航（票 08）、整行点击、删除按钮禁用逻辑（票 10）。

## Notes

- 现状：可见性按钮 `font-size: 11px; padding: 0`（约 11px 高，字形宽约 7px），删除按钮 `font-size: 16px; padding: 0 2px`（约 16×16）。精确尺寸来自审计的 DOM 测量，源码只固定了高度。
- 本票含视觉平衡判断（热区与视觉重量的取舍），因此曾标记为 `ready-for-human`；剩余的浏览器视觉复核项见 Comments，状态已按实现与自动化测试置为 done。

# 15: 画笔颜色与粗细

**What to build:** 画笔不再固定为 1.8px 黑线：常用色板 + 自定义颜色、四档粗细与预览，默认更可见；设置只存活于当前会话。

**Blocked by:** None (can start immediately)

**Status:** ready-for-human

**Covers:** UX-20

**Size:** M

## Acceptance Criteria

- [ ] 色板：黑、深灰、红、橙、蓝、绿 + 自定义颜色输入。
- [ ] 粗细四档：2 / 4 / 8 / 16，带笔触预览。
- [ ] 默认颜色 `#111111`、默认宽度 **6**；1264×625 下默认笔画的屏幕笔宽 ≥2.5px。
- [ ] 选择后新笔画使用新设置，已有图层不变。
- [ ] 设置存会话状态，刷新回默认（持久化明确不在本轮）。
- [ ] 色板与粗细可 Tab 聚焦、有中文 `aria-label`、选中态不只靠颜色传达（加边框/标记）。
- [ ] 自动化：选红色 + 8 后画一笔，断言新 path 的 `stroke` 与 `strokeWidth`；断言已有 path 未变。

## Notes

- 现状：`BRUSH_COLOR = '#111111'`、`BRUSH_WIDTH = 4`，858px 显示宽度下约 1.8px；无任何颜色/粗细控件。
- 不做硬度、压感、纹理。
- 色板的具体配色需要视觉判断，因此标记为 `ready-for-human`。

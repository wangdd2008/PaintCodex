# 05: 缩放/平移下的 AI 高亮与选区换算

**What to build:** AI 的「看这里」高亮与选中定位框跟随视图变换，缩放平移后仍贴住目标。

**Blocked by:** 04

**Status:** ready-for-agent

**Size:** S

## Acceptance Criteria

- [ ] 高亮层从「画布框百分比定位」改为绝对像素定位。
- [ ] 文档坐标 → 屏幕像素：`x * scale + offsetX`、`y * scale + offsetY`（读 `canvas.viewportTransform`）。
- [ ] 缩放与平移过程中高亮实时跟随，不跳位、不延迟到下一次重绘。
- [ ] 3 秒到期逻辑与 `nonce` 重播机制不变。
- [ ] `canvas_select` 的区域指示与图层指示都正确（两者走同一套换算）。
- [ ] 手动验收：缩放到 200% 后触发一次 AI 选择，高亮框仍框住目标图层。

## Notes

- `docToScreen` 纯函数由票 04 提供，本票只做接线与样式。
- 高亮的 3px 边框在缩放后保持屏幕像素宽度，不随缩放变粗。

# 08: 选中图层语义与键盘可达

**What to build:** 让「选中图层」真的意味着选中了什么：AI 图层在画布上被选中并可变换，笔迹图层短时高亮；图层行成为可聚焦控件，键盘能完成整套图层管理。

**Blocked by:** 06

**Status:** ready-for-agent

**Covers:** UX-09

**Size:** M

## Acceptance Criteria

- [ ] 点击 AI 图层行 → 该图层成为 Fabric `activeObject`，出现变换框且可拖动/缩放；变换结果写回 SVG 内容。
- [ ] 点击笔迹图层行 → 画布上该笔迹高亮 800ms ±100ms 后恢复。
- [ ] 图层行可聚焦（`button` 或 `listbox` + `option`），`↑`/`↓` 移动焦点，`Home`/`End` 到首尾，`Enter`/`Space` 选中。
- [ ] 全流程可键盘完成：选择图层、隐藏/显示、删除、撤销。
- [ ] 焦点可见：`:focus-visible` 2px、offset 2px、对比 ≥3:1。
- [ ] 读屏播报名称、类型、可见性、选中态。
- [ ] 若某行的点击行为最终不做，必须移除整行点击与 `cursor: pointer`（诚实降级），不得保留「看着能点但没反应」的交互。
- [ ] 自动化：键盘序列（Tab → ↓ → Enter → Delete → Ctrl+Z）后断言图层数量与可见性回到预期。

## Notes

- 「选中/定位」不是「绘制目标」：一笔仍然只生成一个图层（spec §7）。
- 行内重命名与透明度作用于该行，与 `activeLayerId` 无关，不要合并成一个状态（票 09）。

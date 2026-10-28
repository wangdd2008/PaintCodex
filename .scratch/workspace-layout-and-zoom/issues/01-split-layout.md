# 01: 右栏两列 + 可拖宽度 + 折叠 + 记忆

**What to build:** 把固定 300px 的单列右栏拆成「图层 240px + 对话可拖 320–640px」，宽度记住、可折叠、键盘可调。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

**Size:** M

## Acceptance Criteria

- [ ] `.workspace` 网格改为 `56px minmax(0,1fr) 240px var(--chat-width)`；`--chat-width` 默认 380px。
- [ ] 两列之间是 6px 分隔条：`role="separator"`、`aria-orientation="vertical"`、`aria-valuenow/min/max`、`tabIndex=0`。
- [ ] 鼠标拖拽用 `pointerdown` + `setPointerCapture`；拖动期间禁止文本选择与画布交互。
- [ ] 键盘 `←`/`→` ±16px，`Home`/`End` 跳到最小/最大；双击复位到 380px。
- [ ] 宽度 clamp 在 320–640px，写入 `localStorage['paintcodex.chatWidth']`，刷新后恢复。
- [ ] 对话列可整体收起；收起后列宽为 0，记住的宽度保留，再展开时恢复。
- [ ] 图层列固定 240px 不可拖，但可折叠；折叠后留一条纵向把手。
- [ ] 1440×900 默认布局下画布区宽度 ≥ 600px。

## Notes

- 拖拽时不要让 `<canvas>` 收到指针事件（见 ADR-0011 的视口改造，两个票会碰同一个 CSS 文件）。
- 与票 03 的窄屏规则互斥：≤860px 时分隔条隐藏。

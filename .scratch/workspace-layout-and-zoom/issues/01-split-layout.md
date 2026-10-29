# 01: 右栏两列 + 可拖宽度 + 折叠 + 记忆

**What to build:** 把固定 300px 的单列右栏拆成「图层 240px + 对话可拖 320–640px」，宽度记住、可折叠、键盘可调。

**Blocked by:** None (can start immediately)

**Status:** done

**Size:** M

## Acceptance Criteria

- [x] `.workspace` 网格改为 `56px minmax(0,1fr) 240px var(--chat-width)`；`--chat-width` 默认 380px。
- [x] 两列之间是 6px 分隔条：`role="separator"`、`aria-orientation="vertical"`、`aria-valuenow/min/max`、`tabIndex=0`。
- [x] 鼠标拖拽用 `pointerdown` + `setPointerCapture`；拖动期间禁止文本选择与画布交互。
- [x] 键盘 `←`/`→` ±16px，`Home`/`End` 跳到最小/最大；双击复位到 380px。
- [x] 宽度 clamp 在 320–640px，写入 `localStorage['paintcodex.chatWidth']`，刷新后恢复。
- [x] 对话列可整体收起；收起后列宽为 0，记住的宽度保留，再展开时恢复。
- [x] 图层列固定 240px 不可拖，但可折叠；折叠后留一条纵向把手。
- [x] 1440×900 默认布局下画布区宽度 ≥ 600px。

## Notes

- 拖拽时不要让 `<canvas>` 收到指针事件（见 ADR-0011 的视口改造，两个票会碰同一个 CSS 文件）。
- 与票 03 的窄屏规则互斥：≤860px 时分隔条隐藏。


## Comments

- 2026-10-29 · 实现完成：`2e4034a`，合入 integration 分支 `feat/canvas-library-workspace-monitor`（merge `5d8acf1`）；经 code-review 双轴复查与统一修复（`4475df8`/`bdcc10a`）后验收全部满足，关闭。

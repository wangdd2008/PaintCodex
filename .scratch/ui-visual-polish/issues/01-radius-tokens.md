# 01: 圆角 token 收紧（快赢 1）

**What to build:** 设计系统圆角阶梯从 20/12/8/999 收到 12/8/6/999，让界面从「圆润」转为「锐利克制」。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

**Covers:** ui-visual-polish spec §Implementation Decisions 1

**Size:** S

## Acceptance Criteria

- [ ] `--radius-card` 与 `--radius-panel` 从 20px 改为 12px。
- [ ] `--radius-small` 从 12px 改为 8px。
- [ ] `--radius-chip` 从 8px 改为 6px。
- [ ] `--radius-control` 保持 999px 不变。
- [ ] 组件内写死的「容器圆角」值（消息气泡 18px、canvas-frame 8px 等）保持不动。
- [ ] 引用了上述 token 的面板、工具条、库卡片、监控页统计卡片、折叠把手自动继承新圆角，无逐处硬编码回退。

## Notes

- 只改 `app.css` 的 `:root` token 定义与头注释中的圆角阶梯说明。
- 不改任何组件的局部圆角值。
- 验收需在监控页与画布工作区截图确认继承生效。

## Comments

# 04: 画布库卡片 hover 反馈（快赢 5）

**What to build:** 卡片 hover 从 `translateY(-1px)` 位移改为边框高亮 + 缩略图轻微放大，键盘 focus 反馈保持。

**Blocked by:** 03（同 `canvas-library.css` 文件，避免并行冲突）

**Status:** ready-for-agent

**Covers:** ui-visual-polish spec §Implementation Decisions 5

**Size:** S

## Acceptance Criteria

- [ ] `.canvas-card` hover 去掉 `translateY(-1px)`。
- [ ] hover 时边框高亮（现 `#2e2e2e` 提亮一级）生效。
- [ ] hover 时缩略图 `img` 轻微放大（约 1.02），受 `overflow: hidden` 裁剪，无结构改动。
- [ ] `focus-visible` 的 outline 样式保留；hover 与 focus 反馈不互相覆盖。
- [ ] 键盘 Tab 遍历库卡片时 focus 可见。

## Notes

- 只改 `canvas-library.css`。
- 缩略图 `scale` 需加 `transform-origin: center` 与 `transition`，并考虑 `prefers-reduced-motion`（若项目已有该约定则遵循；没有则保持 120ms 一致节奏）。

## Comments

# 02: 标题排版 token（快赢 2）

**What to build:** 全局标题字号 20→22px、中文标题字距 -0.01em→-0.02em，拉开标题与正文的层级差。

**Blocked by:** 01（同 `app.css` 的 `:root` 区域，避免并行冲突）

**Status:** done

**Covers:** ui-visual-polish spec §Implementation Decisions 2

**Size:** S

## Acceptance Criteria

- [x] `--fs-title` 从 20px 改为 22px。
- [x] `--fs-kpi`（24px）、`--fs-section`（16px）、`--fs-body`（14px）、`--fs-small`（12px）保持不变。
- [x] 标题类元素（页面标题、面板标题、空态标题、菜单栏品牌名等使用 -0.01em 的位置）字距收紧到 -0.02em。
- [x] 正文与标签保持 0 字距。
- [x] 不引入新字体文件，不改变任何字号以外的高度/行高计算。

## Notes

- 只改 `app.css` 的 `:root` 与标题元素样式；字号改动可能影响 `--nav-row`/`--row-height` 等尺寸变量，改后检查标题是否溢出控件高度。
- 验收需在画布库标题与空态标题截图确认。

## Comments

- 2026-10-31 · 验收通过，随 876bbe（feat(web): UI 高级化快赢 1-5）实施并关闭。

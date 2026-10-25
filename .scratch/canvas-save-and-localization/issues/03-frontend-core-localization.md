# 03: 前端核心 UI 中文化

**What to build:** 应用主界面（菜单栏、工具箱、图层面板、状态栏）全部显示中文。

**Blocked by:** None（可立即开始）

**Status:** done

## Acceptance Criteria

- [x] `App.tsx` 中文化：新建画布、导出 PNG、导出 JSON、监控、返回画布、状态栏文案
- [x] `Toolbox.tsx` 中文化：画笔、选择、撤销、重做，以及 title/aria-label
- [x] `LayerPanel.tsx` 中文化：图层、空状态、删除确认对话框、aria-label
- [x] `canvas-store.ts` 中文化：错误提示信息（无法创建画布、无法加载画布等）
- [x] `api.ts` 中文化：通用请求失败错误信息
- [x] `pnpm -r typecheck` 和 `pnpm -r test` 通过

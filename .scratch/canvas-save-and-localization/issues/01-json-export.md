# 01: JSON 导出工具 + 手动导出按钮

**What to build:** 用户可以在菜单栏点击「导出 JSON」按钮，将当前画布数据（含所有图层信息）下载为 JSON 文件到本地。

**Blocked by:** None（可立即开始）

**Status:** ready-for-agent

## Acceptance Criteria

- [ ] 新增 `json-export.ts` 工具文件，提供 `downloadCanvasJson(canvas, filename)` 函数
- [ ] JSON 格式为 `{ version: "1.0", exportedAt: number, canvas: CanvasDocument }`
- [ ] `App.tsx` 菜单栏「导出 PNG」旁新增「导出 JSON」按钮
- [ ] 点击按钮时触发浏览器下载 `.json` 文件
- [ ] 新增 `json-export.test.ts` 测试文件，覆盖 filename 生成和数据序列化
- [ ] `pnpm -r typecheck` 和 `pnpm -r test` 通过

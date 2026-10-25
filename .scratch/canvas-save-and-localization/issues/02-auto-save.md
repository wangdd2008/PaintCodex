# 02: 自动保存

**What to build:** 画布每 30 秒自动导出 JSON 到本地，无需用户手动操作。

**Blocked by:** 01

**Status:** done

## Acceptance Criteria

- [x] `App.tsx` 添加 `useEffect` + `setInterval`，每 30 秒自动触发 JSON 导出
- [x] 仅当画布存在时触发自动保存
- [x] 自动保存静默执行，不打扰用户（无弹窗/通知）
- [x] `pnpm -r typecheck` 和 `pnpm -r test` 通过

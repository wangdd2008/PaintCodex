# 02: 自动保存

**What to build:** 画布每 30 秒自动导出 JSON 到本地，无需用户手动操作。

**Blocked by:** 01

**Status:** done

## Acceptance Criteria

- [x] `App.tsx` 添加 `useEffect` + `setInterval`，每 30 秒自动触发 JSON 导出
- [x] 仅当画布存在时触发自动保存
- [x] 自动保存静默执行，不打扰用户（无弹窗/通知）
- [x] `pnpm -r typecheck` 和 `pnpm -r test` 通过

## Comments

- 2026-10-26: **被取代（superseded），非回归。** 产品审计确认「每 30 秒下载 JSON」不构成保存：文件无法回灌、与同名画布互相覆盖、失败时笔画被静默移除。本轮正式撤销该机制，改为「服务端持久化即保存 + 状态栏保存状态 + 失败保留笔迹」。原用户故事（别丢工作）由新方案承接。见 `docs/adr/0008-save-semantics.md` 与 `.scratch/release-hardening/spec.md`。本票 `Status` 保持 `done`——它确实按原验收标准交付了。

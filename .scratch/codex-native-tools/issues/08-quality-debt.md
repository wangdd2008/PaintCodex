# 08: AI 层的质量债（评审遗留，不阻塞 spec）

**What to build:** 修掉两轴评审在 Standards 侧留下的 smell。功能已验收，这一票只降低后续维护成本。

**Blocked by:** 无（基于 `feat/codex-native-tools` 的最终状态）

**Status:** ready-for-agent

来源：code-review 的 Standards 轴（2026-10-28），逐条带出处。

- [ ] **重复的挂起通道**：`runtime/render-preview.ts` 与 `runtime/export-png.ts` 是同一台机器（同构的 pending 表、`settle()`、`beginTurn/failTurn/closed`、发射＋超时脚手架），差异只有结果类型、`deliver()` 校验与导出的按画布互斥。抽 `runtime/request-channel.ts`（`createRequestChannel({ timeoutMs, createId, unavailable, deliver })`），两个文件退化为 ~50 行适配器。`confirmation.ts` 保持独立（它有已结算保留、幂等、按画布取消）。
- [ ] **同一文件内三连重复**：`codex-runtime.ts` 里「检查已结束 → suspendTimeout() → try/finally resumeTimeout()」写了两遍以上（确认、渲染、导出），抽一个 `humanWait(fn)`。
- [ ] **Repeated Switches**：运行时用 `call.tool === 'canvas_create_layer'` / `'canvas_select'` 反向重推 `tools.ts` 里的工具表。让工具定义自己声明「成功后触发 onLayerCreated/onSelect」，传输层不认工具名。
- [ ] **跨端重复且已漂移**：`readRegion` 在 `tools.ts`（拒绝非正尺寸）与 `AiChatPanel.tsx`（接受）各写一份。移进 `packages/protocol`，两侧共用；保留 daemon 的严格校验。
- [ ] **原始类型占用**：`CanvasToolResult.code` 是裸 `string`，web 另维护一份 `TOOL_FAILURE_TEXT`；确认超时 `60_000` 在 daemon 与 web 各写一次。在 protocol 里给出失败码联合类型与超时常量，两侧引用。
- [ ] **投机性通用**：`ConfirmationChannel.pendingCount`、`CodexRuntime.getThreadId`、`getActiveTurn` 无生产调用方。删除，或保留时在注释里写明「仅测试断言用」。
- [ ] **格式残留**：`AiChatPanel.tsx` 中 `function parseFrame(...) {  const data = ...`（合并产物，lint 只跑 tsc 抓不到）。
- [ ] **API 调用不一致**：confirm 用内联 `await fetch('/paint/ai/confirm')`，另两个回传走 `services/api.ts`。统一到 `services/api.ts`。
- [ ] 全部行为不变：`pnpm -r typecheck` + `pnpm -r test` 连续两次通过，且测试**不改断言**（只允许改 import 路径）。

## Comments

2026-10-28 — 由父代理在 code-review 后创建。当时判断：功能与文档已验收，这些是重构而非缺陷，混进验收提交会扩大回归面，因此单独立票。

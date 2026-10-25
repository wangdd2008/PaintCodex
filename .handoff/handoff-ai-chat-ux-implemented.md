# Handoff: AI Chat UX Improvements 已实现并合入 main

> Generated: 2026-10-25
> Supersedes: 无。`.handoff/handoff.md` 是用户自己的上一轮交接记录，本轮未修改它。

## Current state

- `main` 为 **`5abcd57`**（`--no-ff` 合入 `feat/ai-chat-ux-improvements`）。
- 集成分支 `feat/ai-chat-ux-improvements` 仍在 **`f11491c`**，尚未删除。
- **尚未推送远端**；`main` 的上游显示 `origin/main: gone`，推送或开 PR 需用户明确授权。
- 票据 01、02 均已 `Status: done`；实现用的两个 worktree（`ai-chat-clear-input`、`ai-chat-step-progress`）与对应 ticket 分支已删除。
- `feat/phase-1-mvp` 仍停在 `0b9c3c8`。
- 工作区有用户未提交内容，**不要动**：`M .handoff/handoff.md`、`M AGENTS.md`、`M GLOSSARY.md`、`?? README.md`、`?? .qwen/settings.json`、`?? .handoff/handoff-agent-observability-implemented.md`。
- 开发服务已按用户要求停止；`3210` / `5173` 无监听。

## What shipped（只给指针，细节不要在此重复）

- Spec：`.scratch/ai-chat-ux-improvements/spec.md`
- ADR：`docs/adr/0007-ai-chat-ux-improvements.md`
- 票据：`.scratch/ai-chat-ux-improvements/issues/01-clear-input.md`、`02-step-progress.md`（均 done，含提交号与验证记录）
- 提交历史：`git log --oneline main..feat/ai-chat-ux-improvements`，以及集成合并 `5abcd57`
- 代码地图：
  - 协议：`packages/protocol/src/index.ts`（新增 `StreamPayload`，含 `step`）
  - 后端 step 事件：`apps/daemon/src/api/routes.ai.ts`（`AI_CHAT_STEPS` + `sendStep()`）
  - 前端面板：`apps/web/src/features/ai-chat/AiChatPanel.tsx`、`ai-chat.css`
  - 测试：`apps/daemon/test/ai-chat.test.ts`、`apps/web/test/ai-chat-panel.test.tsx`
  - 新增前端测试环境：`apps/web/package.json`（jsdom + React Testing Library，`b67e382`）

## Verification evidence

- `pnpm -r typecheck` 通过；`pnpm -r test` 通过（web **57** / daemon **103**）；`pnpm -r build` 通过（仅 Vite 既有 chunk-size 警告）。
- 合并后树一致性：`git diff f11491c main` 为空。
- 手工验收：已启动 `pnpm dev`，`/health` 返回 `{"ok":true}`、`http://localhost:5173` 返回 200；用户未反馈逐项 UI 验收结果，随后要求停止服务。**手工 UI 验收结论未确认**。
- 停止服务后 `pnpm dev` 的 daemon 子进程以退出码 1 结束、并出现 `ECONNRESET` 代理日志，这是取消后台任务时的正常关闭表现（启动初期 `18:52:34` 的 `ECONNREFUSED 3210` 也只是 vite 先于 daemon 就绪），不代表崩溃。
- 本机 `codex-cli 0.164.0` 可用（AI chat 依赖其已登录）。

## Accepted decisions / known trade-offs

- 步骤事件严格按 spec 在既有 span/log 节点发送；`prompt_built`、`action_parse` 在动作完成后发送，故文案显示窗口很短，属 spec 规定行为，未改。
- 撤销只在「清空之后、重新编辑或发送之前」有效；重新输入或发送会作废撤销机会（code review 修正）。
- 请求进行中隐藏「清空/撤销」，避免取消按钮误触草稿状态；textarea 本身此时也是 disabled。
- 超时文案靠匹配 runner 的 `Codex CLI timed out after <n>ms` 文本；若 `codex-runner.ts` 改措辞，前端会回退展示原始英文错误。
- 取消与 `done` 存在极小竞态：若流已结束但 `inFlight` 尚未落状态时点「取消」，不会显示「已取消」。
- 既有英文 UI 文案（`Send`、`Thinking…`、`You`）未本地化；本功能新增文案为中文。

## Open items / suggested next steps

1. 若用户确认：推送 `main` 或开 PR（注意远端 `origin/main` 上游缺失）。
2. 若手工验收发现问题，优先在 `AiChatPanel.tsx` + `ai-chat-panel.test.tsx` 内做行为修复（先红后绿）。
3. 可选后续（未立项）：UI 文案统一/i18n、步骤文案抽到 locale、发送后撤销语义再确认、为 runner 超时引入独立错误码替代文本匹配。
4. 如需删除集成分支：确认 `main` 已包含 `f11491c` 后再删。

## How to run

```bash
pnpm install
pnpm dev        # web http://localhost:5173（IPv6 localhost）, daemon :3210
pnpm -r typecheck
pnpm -r test
pnpm -r build
```

前端组件测试约定：文件首行 `// @vitest-environment jsdom`，从 `@testing-library/react` 引入，`afterEach` 显式 `cleanup()` 并 `vi.unstubAllGlobals()`（本仓库未开启 vitest globals）。单文件运行：

```bash
pnpm --filter @paintcodex/web exec vitest run test/ai-chat-panel.test.tsx
pnpm --filter @paintcodex/daemon exec vitest run test/ai-chat.test.ts
```

## Suggested skills

- **`tdd`** — 继续改 AI chat 行为时先写失败测试。
- **`code-review`** — 对后续改动作 Standards / Spec 两轴审查。
- **`implement-spec`** — 下一个 spec 的票据任务图实现流程。
- **`diagnosing-bugs`** — 若 UI 验收发现步骤/取消异常。
- **`pr`** — 需要写 PR 描述或准备推送时。
- **`agent-browser`** — 手动验收 AI chat 面板与画布交互。
- **`handoff`** — 再次交接时生成本类文档。

## Context pointers

| Need | Read |
|---|---|
| 行为、SSE 协议、验收标准 | `.scratch/ai-chat-ux-improvements/spec.md` |
| 架构决策、步骤映射表 | `docs/adr/0007-ai-chat-ux-improvements.md` |
| 票据状态与实现/合并提交号 | `.scratch/ai-chat-ux-improvements/issues/01-`、`02-` |
| 本次改动全貌 | `git diff main~1..main`、`git log --oneline 20acce7..main` |
| 领域词汇 | `GLOSSARY.md` |
| 工作流 / 问题跟踪约定 | `AGENTS.md`、`docs/agents/` |

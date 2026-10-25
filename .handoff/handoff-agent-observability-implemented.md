# Handoff: Agent Observability 已实现并合入 main

> Generated: 2026-10-25
> Supersedes: `.handoff/handoff.md`（上一轮「设计完成」交接；按用户要求未修改该文件）

## Current state

- `main` 与 `feat/agent-observability` 同为 **`20acce7`**；由 `0b9c3c8` 快进合并而来。
- **尚未推送远端**；`main` 的 `origin/main` 上游已不存在。推送或开 PR 需用户明确授权。
- 票据 01–06 均已 `Status: done`；实现/修复用的 worktree 与临时分支已删除。
- `feat/phase-1-mvp` 仍停在 `0b9c3c8`。
- 工作区有用户未提交内容，**不要动**：`M .handoff/handoff.md`、`M AGENTS.md`、`?? README.md`、`?? .qwen/settings.json`。

## What shipped（只给指针，细节不要在此重复）

- Spec：`.scratch/agent-observability/spec.md`
- ADR：`docs/adr/0006-agent-observability.md`
- 票据：`.scratch/agent-observability/issues/01-` … `06-`（全部 done，含实现/合并提交记录）
- 提交历史：`git log --oneline 0b9c3c8..20acce7`
- 代码地图：
  - 基础设施：`apps/daemon/src/observability/`
  - 埋点：`apps/daemon/src/api/server.ts`、`routes.ai.ts`、`routes.events.ts`、`paint/service.ts`、`paint/agent/codex-runner.ts`
  - Monitor API/SSE：`apps/daemon/src/api/routes.monitor.ts`
  - 监控页：`apps/web/src/features/monitor/`、`apps/web/src/app/view-route.ts`、`App.tsx`
  - 共享类型：`packages/protocol/src/index.ts`（`AgentLog` / `AgentTrace` / `MonitorStats` 等）
- 代码审查修复：`a0445d8`（统计口径、`action_apply` 失败 span、服务端时间过滤、`db_migrated`、ADR 对齐）。

## Verification evidence

- `pnpm -r typecheck`、`pnpm -r test`、`pnpm -r build` 全绿：**daemon 101 tests / web 47 tests**。
- 手动验收（2026-10-25）：`pnpm dev` → `http://localhost:5173/?page=monitor`；SSE 实时日志、trace 树、统计卡片均正常；真实 Codex chat 返回 `pong`，trace `305ce9b2-5c3e-47ea-8dca-6c8e54bc969f` 在 UI 中展示为 `HTTP → chat_completed → prompt_built / codex_exec / action_parse / sse_complete`。
- 截图：`.qwen/tmp/monitor-page.png`、`.qwen/tmp/monitor-trace.png`（本会话终端无法内嵌预览）。

## Accepted decisions / known trade-offs

- 十项设计决策仍然有效，见 ADR-0006 与 `.handoff/handoff.md`；**不要重新讨论**。
- 监控页自身的 HTTP 轮询会被计入请求统计（QPS 略含自身）——已判定可接受。
- 统计面板每 5 秒轮询一次，SSE 只负责日志流——已判定可接受。
- `agent_logs` 无清理/保留策略，按 spec 明确推迟。
- spec/ADR/票据为英文；`AGENTS.md` 偏好新文档用中文，但这些是上一轮已定稿的设计产物，未翻译。
- 监控 SSE 自身不写日志，避免反馈环；`sse_disconnect` 为 best-effort。

## Open items / suggested next steps

1. 若用户确认：推送 `main` 或开 PR（注意远端 `origin/main` 上游缺失）。
2. 下一阶段功能尚未立项；可从 `.scratch/` 现有 spec 或用户新需求开始。
3. 若要改 daemon 观测相关文件，先确认没有其他 Qwen 会话并发修改同一批文件（同目录可能并存多个会话）。

## How to run

```bash
pnpm install
pnpm dev        # web :5173, daemon :3210
pnpm -r test
pnpm -r build
```

AI chat 需要本机 `codex` 已登录；仅验证监控/画布日志时可只用画布 API 生成 `http` / `canvas-action` 记录。

## Suggested skills

- **`implement-spec`** — 按 spec + 票据任务图实现下一个功能（本功能即用此流程）。
- **`tdd`** — 下一阶段功能测试先行。
- **`code-review`** — 对后续改动作 Standards / Spec 两轴审查。
- **`pr`** — 需要写 PR 描述或准备推送时。
- **`agent-browser`** — 手动验收监控页等 Web UI。
- **`handoff`** — 再次交接时生成本类文档。

## Context pointers

| Need | Read |
|---|---|
| 行为、API、验收标准 | `.scratch/agent-observability/spec.md` |
| 架构决策与替代方案 | `docs/adr/0006-agent-observability.md` |
| 票据状态与实现提交 | `.scratch/agent-observability/issues/01-` … `06-` |
| 本次改动全貌 | `git log --oneline 0b9c3c8..20acce7`、`git diff 0b9c3c8..20acce7` |
| 领域词汇 | `GLOSSARY.md` |
| 工作流 / 问题跟踪约定 | `AGENTS.md`、`docs/agents/` |

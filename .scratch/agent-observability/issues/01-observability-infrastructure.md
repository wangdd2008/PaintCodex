# 01: Observability Infrastructure

**What to build:** The backend observability module — types, repository, logger, events, DB migration, and protocol type extensions.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Add `agent_logs` table to `apps/daemon/src/storage/database.ts` migration
- [x] Create `apps/daemon/src/observability/types.ts` — `AgentLog`, `LogLevel`, `LogCategory`, `NewAgentLogRecord`, etc.
- [x] Create `apps/daemon/src/observability/repository.ts` — `AgentLogRepository` with insert, query, and pagination
- [x] Create `apps/daemon/src/observability/logger.ts` — `ObservabilityLogger` singleton with trace/span API
- [x] Create `apps/daemon/src/observability/events.ts` — `ObservabilityEvents` pub/sub for SSE push
- [x] Extend `packages/protocol/src/index.ts` with `LogLevel`, `LogCategory`, `AgentLog`, `MonitorStats`
- [x] Unit tests for `AgentLogRepository`
- [x] Unit tests for `ObservabilityLogger` (trace/span lifecycle)
- [x] Unit tests for `ObservabilityEvents`
- [x] `pnpm typecheck` and `pnpm -r test` pass

## Comments

2026-10-25 — Implemented and merged into `feat/agent-observability`.

- Implementation commit: `969c56d`; review fixes: `a0445d8`.
- Verification: `pnpm -r typecheck`, `pnpm -r test` (daemon 101, web 47), `pnpm -r build` all pass.
- Notes: `buildServer` owns one logger per daemon instance; `ObservabilityLogger.repository` is exposed for integration tests. A pre-existing type error in `apply-action.test.ts` was fixed so `pnpm typecheck` passes.

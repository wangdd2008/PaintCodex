# 01: Observability Infrastructure

**What to build:** The backend observability module — types, repository, logger, events, DB migration, and protocol type extensions.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Add `agent_logs` table to `apps/daemon/src/storage/database.ts` migration
- [ ] Create `apps/daemon/src/observability/types.ts` — `AgentLog`, `LogLevel`, `LogCategory`, `NewAgentLogRecord`, etc.
- [ ] Create `apps/daemon/src/observability/repository.ts` — `AgentLogRepository` with insert, query, and pagination
- [ ] Create `apps/daemon/src/observability/logger.ts` — `ObservabilityLogger` singleton with trace/span API
- [ ] Create `apps/daemon/src/observability/events.ts` — `ObservabilityEvents` pub/sub for SSE push
- [ ] Extend `packages/protocol/src/index.ts` with `LogLevel`, `LogCategory`, `AgentLog`, `MonitorStats`
- [ ] Unit tests for `AgentLogRepository`
- [ ] Unit tests for `ObservabilityLogger` (trace/span lifecycle)
- [ ] Unit tests for `ObservabilityEvents`
- [ ] `pnpm typecheck` and `pnpm -r test` pass

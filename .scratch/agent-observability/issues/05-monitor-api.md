# 05: Monitor API and SSE

**What to build:** REST API and SSE endpoint for the monitoring page to consume.

**Blocked by:** 01 (Observability Infrastructure), 02 (HTTP Instrumentation), 03 (Codex & AI Chat Instrumentation), 04 (Canvas Operation Instrumentation)

**Status:** ready-for-agent

- [ ] Create `apps/daemon/src/api/routes.monitor.ts` — `GET /monitor/logs` with pagination and filters
- [ ] Create `GET /monitor/traces/:traceId` — return all spans for a trace as a tree
- [ ] Create `GET /monitor/stats` — aggregate stats (request count, error rate, avg duration, category distribution)
- [ ] Create `GET /monitor/events` — SSE endpoint for real-time log streaming via `ObservabilityEvents`
- [ ] Register monitor routes in `apps/daemon/src/api/server.ts`
- [ ] Integration tests for all monitor routes
- [ ] Integration tests for SSE log streaming
- [ ] `pnpm typecheck` and `pnpm -r test` pass

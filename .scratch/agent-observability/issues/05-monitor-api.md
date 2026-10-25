# 05: Monitor API and SSE

**What to build:** REST API and SSE endpoint for the monitoring page to consume.

**Blocked by:** 01 (Observability Infrastructure), 02 (HTTP Instrumentation), 03 (Codex & AI Chat Instrumentation), 04 (Canvas Operation Instrumentation)

**Status:** done

- [x] Create `apps/daemon/src/api/routes.monitor.ts` — `GET /monitor/logs` with pagination and filters
- [x] Create `GET /monitor/traces/:traceId` — return all spans for a trace as a tree
- [x] Create `GET /monitor/stats` — aggregate stats (request count, error rate, avg duration, category distribution)
- [x] Create `GET /monitor/events` — SSE endpoint for real-time log streaming via `ObservabilityEvents`
- [x] Register monitor routes in `apps/daemon/src/api/server.ts`
- [x] Integration tests for all monitor routes
- [x] Integration tests for SSE log streaming
- [x] `pnpm typecheck` and `pnpm -r test` pass

## Comments

2026-10-25 — Implemented and merged into `feat/agent-observability`.

- Implementation commit: `2041de6`, merge `f9cfa84`; statistics semantics fixed in `a0445d8`.
- Verification: `pnpm -r typecheck`, `pnpm -r test` (daemon 101, web 47), `pnpm -r build` all pass.
- Notes: `/monitor/events` never logs its own traffic, avoiding a feedback loop. `errorRate` is the HTTP failure rate (warn or error), `avgDurationMs` is the HTTP average, and `aiChatSuccessRate` counts only `info`-level `chat_completed` records.

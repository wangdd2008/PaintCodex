# Spec: Agent Observability with SQLite-backed Structured Logging

## Problem Statement

PaintCodex Phase 1 MVP delivers a working AI-assisted canvas editor, but the daemon operates as a black box. There is no way to observe:

- How long Codex CLI takes to respond or why it fails.
- The full lifecycle of an AI chat request (prompt → delta stream → canvas action → SSE push).
- Canvas mutation patterns (undo/redo frequency, agent vs. user actions).
- HTTP request latency and error rates.

Without structured telemetry, debugging agent failures requires reading ad-hoc `console.log` or manually reproducing issues. As the AI agent grows more complex (multi-turn, tool use, confirmation flows), this becomes untenable.

## Solution

Introduce a **structured logging system** backed by the existing SQLite database, with an **independent monitoring page** in the web frontend for real-time visualization.

Key components:
1. **SQLite `agent_logs` table** — stores structured log entries with trace/span support.
2. **Observability module** — `AgentLogRepository`, `ObservabilityLogger` (singleton with trace/span API), and `ObservabilityEvents` (SSE push).
3. **Instrumentation** — targeted logging at Codex runner, AI chat, canvas operations, and HTTP layers.
4. **Monitor API** — REST endpoints for querying logs, traces, stats, and an SSE endpoint for real-time streaming.
5. **Monitor page** — React-based independent page with log list, trace view, stats panel, and live SSE updates.
6. **Protocol extensions** — shared `LogLevel`, `LogCategory`, `AgentLog`, `MonitorStats` types.

## User Stories

1. As a developer, I want to see the full lifecycle of an AI chat request (from prompt to SSE push) in a single trace view, so that I can diagnose where failures occur.
2. As a developer, I want to see Codex CLI spawn/delta/complete/error events with timestamps and durations, so that I can understand why AI responses are slow or fail.
3. As a developer, I want to see all canvas mutations (create/update/delete/undo/redo) with actor and revision, so that I can debug state conflicts and undo/redo issues.
4. As a developer, I want to see HTTP request latency and error rates, so that I can identify slow endpoints and failing requests.
5. As a developer, I want real-time log streaming on a monitoring page, so that I can observe agent behavior as it happens without refreshing.
6. As a developer, I want to filter logs by category, level, and time range, so that I can focus on specific types of events.
7. As a developer, I want aggregate statistics (QPS, error rate, AI success rate), so that I can assess overall system health at a glance.
8. As a developer, I want the monitoring page to show trace trees with parent/child span relationships, so that I can understand the hierarchical structure of complex operations.
9. As a developer, I want logs to persist across daemon restarts, so that I can review historical data.
10. As a developer, I want the logging system to have zero new runtime dependencies, so that the install and build process stays simple.

## Implementation Decisions

### Storage: SQLite `agent_logs` table

Reuses the existing `better-sqlite3` connection. The table stores structured log entries with trace/span support for request-level tracing.

Schema:

```sql
CREATE TABLE agent_logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  trace_id      TEXT,
  span_id       TEXT,
  parent_id     TEXT,
  timestamp     INTEGER NOT NULL,
  level         TEXT CHECK(level IN ('debug','info','warn','error')),
  category      TEXT NOT NULL,
  message       TEXT NOT NULL,
  payload       TEXT,
  duration_ms   INTEGER,
  error         TEXT,
  canvas_id     TEXT,
  revision      INTEGER,
  actor         TEXT
);
```

Categories: `codex-runner`, `ai-chat`, `canvas-action`, `http`, `sse`, `system`.

**Rationale**: SQLite provides both storage and queryability without adding new dependencies. WAL mode ensures writes do not block reads.

### Backend: Observability module

A new `src/observability/` module in the daemon provides:

- **`AgentLogRepository`** — SQLite read/write for `agent_logs`.
- **`ObservabilityLogger`** — singleton with trace/span API (`startTrace`, `childSpan`, `log`, `finish`).
- **`ObservabilityEvents`** — in-process pub/sub for pushing new logs to SSE subscribers.

**Rationale**: Encapsulating logging in its own module keeps instrumentation points decoupled from storage and transport concerns.

### Instrumentation points

| Category | Location | Events logged |
|----------|----------|---------------|
| `codex-runner` | `codex-runner.ts` | spawn, delta, complete, error (timeout/abort/exit code) |
| `ai-chat` | `routes.ai.ts` | prompt-built, codex-exec, action-parse, action-apply, sse-complete |
| `canvas-action` | `service.ts`, `command-dispatcher.ts` | create, update, delete, undo, redo (with actor + revision) |
| `http` | `server.ts` (Fastify hooks) | all requests: method, path, status, duration |
| `sse` | `routes.events.ts` | subscribe, publish, disconnect |
| `system` | `main.ts` | startup, DB migration |

### API: Monitor routes

New `/monitor/*` routes:

- `GET /monitor/logs` — paginated query with filters (category, level, time range).
- `GET /monitor/traces/:traceId` — all spans for a trace as a tree.
- `GET /monitor/stats` — aggregate stats (request count, error rate, avg duration, category distribution).
- `GET /monitor/events` — SSE endpoint for real-time log streaming.

### Frontend: Monitor page

A new `features/monitor/` in `apps/web` with:

- **Log list** — sortable, filterable table of log entries.
- **Trace view** — expandable tree showing parent/child span relationships and durations.
- **Stats panel** — real-time metrics (QPS, error rate, AI success rate, category counts).
- **Real-time updates** — SSE subscription to `/monitor/events` for live log tailing.

The page is accessed via a new "Monitor" button in the App header. No `react-router` is added; view switching uses query-param-based conditional rendering.

### Protocol extensions

New types added to `packages/protocol`:

- `LogLevel`, `LogCategory`, `AgentLog`, `MonitorStats`.

## Testing Decisions

- **Unit tests for `AgentLogRepository`** — CRUD operations, filtering, pagination.
- **Unit tests for `ObservabilityLogger`** — trace/span lifecycle, parent-child relationships, payload serialization.
- **Unit tests for `ObservabilityEvents`** — subscribe/publish/unsubscribe, listener cleanup.
- **Integration tests for `/monitor/*` routes** — query filtering, SSE streaming, stats aggregation.
- **No E2E tests for the monitor page** — UI verification is manual via `pnpm dev` for Phase 2, consistent with Phase 1 approach.

## Out of Scope

- Log cleanup / retention policy (deferred to a later phase).
- Log export to external systems (e.g., ELK, Grafana, Datadog).
- Distributed tracing across multiple daemon instances (not applicable to local-first design).
- Performance profiling (CPU/memory) of the daemon process.
- Alerting or notification system.

## Further Notes

- **Performance**: Every log write is an `INSERT` to SQLite. High-frequency events (e.g., every SSE heartbeat) must be selective to avoid I/O pressure. The `http` category logs at `onResponse` (not `onRequest`), and SSE heartbeats are not logged.
- **Privacy**: `agent_logs` stores user prompts and AI responses. In a multi-user deployment, access control would be needed. For the local-first Phase 1/2 scope, this is acceptable.
- **Extensibility**: The `payload` JSON column allows adding new fields without schema migrations. The `category` enum can be extended by updating the CHECK constraint.
- **ADR**: See `docs/adr/0006-agent-observability.md` for architectural rationale and alternatives considered.

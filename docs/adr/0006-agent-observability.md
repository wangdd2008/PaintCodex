# ADR-0006: Agent Observability with SQLite-backed Structured Logging

## Status

Accepted — Phase 2

## Context

Phase 1 MVP delivers a working canvas editor with AI chat integration, but the daemon operates as a black box. There is no way to observe:

- How long Codex CLI takes to respond or why it fails.
- The full lifecycle of an AI chat request (prompt → delta stream → canvas action → SSE push).
- Canvas mutation patterns (undo/redo frequency, agent vs. user actions).
- HTTP request latency and error rates.

Without structured telemetry, debugging agent failures requires reading ad-hoc `console.log` or manually reproducing issues. As the AI agent grows more complex (multi-turn, tool use, confirmation flows), this becomes untenable.

## Decision

Introduce a **structured logging system** backed by the existing SQLite database, with an **independent monitoring page** in the web frontend for real-time visualization.

### 1. Storage: SQLite `agent_logs` table

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

### 2. Backend: Observability module

A new `src/observability/` module in the daemon provides:

- **`AgentLogRepository`** — SQLite read/write for `agent_logs`.
- **`ObservabilityLogger`** — per-daemon logger with trace/span API (`startTrace`, `startSpan`, `log`, `finish`).
- **`ObservabilityEvents`** — in-process pub/sub for pushing new logs to SSE subscribers.

`buildServer` creates a unique logger for each daemon instance; it is a singleton only within that process.

### 3. Instrumentation points

| Category | Location | Events logged |
|----------|----------|---------------|
| `codex-runner` | `codex-runner.ts` | spawn, delta, complete, error (timeout/abort/exit code) |
| `ai-chat` | `routes.ai.ts` | prompt-built, codex-exec, action-parse, action-apply, sse-complete |
| `canvas-action` | `service.ts` | create, update, delete, undo, redo (with actor + revision) |
| `http` | `server.ts` (Fastify hooks) | all requests: method, path, status, duration |
| `sse` | `routes.events.ts` | subscribe, publish, disconnect |
| `system` | `main.ts` | startup, DB migration |

### 4. API: Monitor routes

New `/monitor/*` routes:

- `GET /monitor/logs` — paginated query with filters (category, level, time range).
- `GET /monitor/traces/:traceId` — all spans for a trace as a tree.
- `GET /monitor/stats` — aggregate stats (request count, error rate, avg duration, category distribution).
- `GET /monitor/events` — SSE endpoint for real-time log streaming.

### 5. Frontend: Monitor page

A new `features/monitor/` in `apps/web` with:

- **Log list** — sortable, filterable table of log entries.
- **Trace view** — expandable tree showing parent/child span relationships and durations.
- **Stats panel** — real-time metrics (QPS, error rate, AI success rate, category counts).
- **Real-time updates** — SSE subscription to `/monitor/events` for live log tailing.

The page is accessed via a new "Monitor" button in the App header. No `react-router` is added; view switching uses query-param-based conditional rendering.

### 6. Protocol extensions

New types added to `packages/protocol`:

- `LogLevel`, `LogCategory`, `AgentLog`, `MonitorStats`.

## Consequences

- **Positive**: Full request tracing makes agent failures debuggable without reproduction.
- **Positive**: Real-time monitoring page gives immediate feedback during development and agent tuning.
- **Positive**: Zero new runtime dependencies — reuses existing `better-sqlite3` and Fastify.
- **Positive**: SSE-based push avoids polling overhead for the monitor page.
- **Negative**: Every log write is an `INSERT` to SQLite. High-frequency events (e.g., every SSE heartbeat) must be selective to avoid I/O pressure.
- **Negative**: `agent_logs` grows unbounded until a cleanup strategy is added (deferred to a later phase).
- **Negative**: The monitoring page adds UI surface that must be maintained as the main app evolves.
- **Trade-off**: Structured logging in SQLite is queryable but not as scalable as a dedicated log aggregation system (e.g., ELK, Loki). This is acceptable for a local-first, single-user tool.

## Alternatives Considered

| Alternative | Rejected Because |
|---|---|
| File-based JSONL logs | Harder to query from the monitoring page; requires building indexing or parsing logic. SQLite provides both storage and queryability for free. |
| Dedicated time-series DB (e.g., Prometheus, InfluxDB) | Overkill for a local daemon. Adds operational complexity and external dependencies. |
| In-memory only (no persistence) | Survives only as long as the daemon process. Debugging crashes or reviewing historical runs is impossible. |
| Client-side logging (web only) | Misses backend agent execution (Codex CLI, canvas mutations) entirely. |
| External observability platform (Datadog, Grafana Cloud) | Requires network egress and API keys; contradicts the local-first, offline-capable design of Phase 1. |

## Errata

- **2026-10-27（Codex 原生工具切片 2）**：`codex-runner` 分类随旧 `CodexRunner` 一并移除，职责由两个新分类承接：`codex-runtime` 记录 app-server 进程与 JSON-RPC 生命周期，`canvas-tool` 每次工具调用记录名称、参数摘要、结果码与耗时。分类清单以此为准：`codex-runtime`、`canvas-tool`、`ai-chat`、`canvas-action`、`http`、`sse`、`system`。`tool_call` 取代旧 runner 事件，成为 AI 行为统计的锚点。ADR 正文与其余决定保持不变。

# Handoff: Agent Observability Design Complete

> Generated: 2026-10-25
> Session focus: Design Agent Observability feature (grill-with-docs → to-spec → to-tickets)

## Current state

- `main` remains at `0b9c3c8` (unchanged this session).
- **No code changes** were made to `apps/daemon` or `apps/web`.
- All design artifacts are **new files** — untracked and uncommitted.
- Phase 1 MVP is fully implemented and stable; this session scoped Phase 2's first feature.

## What was delivered

A complete design for **Agent Observability** — structured logging and a monitoring page.

- **ADR**: `docs/adr/0006-agent-observability.md` — SQLite-backed structured logging, trace/span model, independent monitor page.
- **Spec**: `.scratch/agent-observability/spec.md` — full spec with problem statement, user stories, implementation decisions, testing decisions, and out-of-scope items.
- **Tickets**: 6 tracer-bullet tickets in `.scratch/agent-observability/issues/01-` through `06-`.

## Decisions made (do not re-litigate)

| Decision | Choice |
|----------|--------|
| Log scope | Backend only (daemon) |
| Agent observation | Both Codex CLI runner **and** AI canvas action lifecycle |
| Visualization | Independent monitor page (not embedded) |
| Storage | SQLite `agent_logs` table (reuses `better-sqlite3`) |
| Log cleanup | **Deferred** — no retention policy for now |
| Monitor page location | `apps/web` (React, zero new router dependencies) |
| Real-time updates | SSE (`/monitor/events`) |
| Trace model | OpenTelemetry-style trace/span hierarchy |
| Zero new runtime dependencies | Confirmed — reuses existing stack |

## Tickets status

| # | Ticket | Blocked by | Status |
|---|--------|------------|--------|
| 01 | Observability Infrastructure | None | ready-for-agent |
| 02 | HTTP Instrumentation | 01 | ready-for-agent |
| 03 | Codex & AI Chat Instrumentation | 01 | ready-for-agent |
| 04 | Canvas Operation Instrumentation | 01 | ready-for-agent |
| 05 | Monitor API and SSE | 01–04 | ready-for-agent |
| 06 | Monitor Frontend Page | 05 | ready-for-agent |

## Architecture at a glance

```
daemon ──► SQLite (agent_logs table)
    │
    ├── ObservabilityLogger (singleton, trace/span API)
    │   ├── AgentLogRepository (SQLite CRUD)
    │   └── ObservabilityEvents (pub/sub → SSE)
    │
    ├── Instrumentation
    │   ├── codex-runner.ts (spawn/delta/complete/error)
    │   ├── routes.ai.ts (prompt → action → SSE)
    │   ├── service.ts (canvas mutations)
    │   └── server.ts (HTTP hook)
    │
    └── Monitor Routes
        ├── GET /monitor/logs (paginated query)
        ├── GET /monitor/traces/:traceId (trace tree)
        ├── GET /monitor/stats (aggregates)
        └── GET /monitor/events (SSE)

web ──► MonitorPage
    ├── LogList (filterable table)
    ├── TraceView (expandable tree)
    ├── StatsPanel (real-time metrics)
    └── SSE subscription to /monitor/events
```

## Suggested skills

Call the Skill tool for:

- **`implement`** or **`implement-spec`** — to start coding the 6 tickets. Start with 01 (Infrastructure), then 02–04 can be parallel.
- **`tdd`** — if you want to build the observability module test-first.
- **`code-review`** — once tickets 01–06 are implemented.
- **`handoff`** — if you need to pass this work to another agent mid-implementation.

## Context pointers

| Need | Read |
|---|---|
| Behaviour, API, acceptance criteria | `.scratch/agent-observability/spec.md` |
| Ticket breakdown | `.scratch/agent-observability/issues/01-` through `06-` |
| Architectural rationale | `docs/adr/0006-agent-observability.md` |
| Phase 1 baseline | `.scratch/phase-1-mvp/spec.md` |
| Domain vocabulary | `GLOSSARY.md` |
| Agent workflow / issue tracker | `AGENTS.md`, `docs/agents/` |

## Gotchas

- `agent_logs` grows unbounded until a cleanup strategy is added (deferred).
- High-frequency events (SSE heartbeats) are intentionally **not** logged to avoid I/O pressure.
- The monitoring page uses query-param-based view switching (`?page=monitor`), not `react-router`.
- `ObservabilityLogger` is a singleton; ensure it's not accidentally instantiated multiple times in tests.
- Start here:
  ```bash
  pnpm install
  pnpm dev        # web :5173, daemon :3210
  pnpm -r test
  pnpm build
  ```

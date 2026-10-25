# 06: Monitor Frontend Page

**What to build:** Independent monitoring page in the web frontend for real-time log visualization.

**Blocked by:** 05 (Monitor API and SSE)

**Status:** done

- [x] Create `apps/web/src/features/monitor/monitor-api.ts` — fetch and SSE client for monitor endpoints
- [x] Create `apps/web/src/features/monitor/LogList.tsx` — sortable, filterable log table
- [x] Create `apps/web/src/features/monitor/TraceView.tsx` — expandable trace tree with span durations
- [x] Create `apps/web/src/features/monitor/StatsPanel.tsx` — real-time metrics (QPS, error rate, AI success rate)
- [x] Create `apps/web/src/features/monitor/MonitorPage.tsx` — page layout combining all components
- [x] Create `apps/web/src/features/monitor/monitor.css` — page styles
- [x] Add "Monitor" button to `apps/web/src/app/App.tsx` header with query-param-based view switching
- [x] Manual verification: open monitor page, trigger AI chat, observe real-time logs and traces
- [x] `pnpm typecheck` and `pnpm -r test` pass

## Comments

2026-10-25 — Implemented and merged into `feat/agent-observability`.

- Implementation commit: `58356ac`, merge `6ba16ed`; server-side time-range filtering added in `a0445d8`.
- Verification: `pnpm -r typecheck`, `pnpm -r test` (daemon 101, web 47), `pnpm -r build` all pass.
- Manual verification: `pnpm dev`, opened `http://localhost:5173/?page=monitor`; live rows streamed in over SSE, and a real Codex chat produced trace `305ce9b2…` rendered as HTTP → `chat_completed` → `prompt_built` / `codex_exec` / `action_parse` / `sse_complete`. Stats showed request count, error rate and HTTP average duration; "Back to Canvas" restored the editor. Category/level/window filters now re-query the daemon with `since`.

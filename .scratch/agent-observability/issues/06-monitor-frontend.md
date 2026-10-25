# 06: Monitor Frontend Page

**What to build:** Independent monitoring page in the web frontend for real-time log visualization.

**Blocked by:** 05 (Monitor API and SSE)

**Status:** ready-for-agent

- [ ] Create `apps/web/src/features/monitor/monitor-api.ts` — fetch and SSE client for monitor endpoints
- [ ] Create `apps/web/src/features/monitor/LogList.tsx` — sortable, filterable log table
- [ ] Create `apps/web/src/features/monitor/TraceView.tsx` — expandable trace tree with span durations
- [ ] Create `apps/web/src/features/monitor/StatsPanel.tsx` — real-time metrics (QPS, error rate, AI success rate)
- [ ] Create `apps/web/src/features/monitor/MonitorPage.tsx` — page layout combining all components
- [ ] Create `apps/web/src/features/monitor/monitor.css` — page styles
- [ ] Add "Monitor" button to `apps/web/src/app/App.tsx` header with query-param-based view switching
- [ ] Manual verification: open monitor page, trigger AI chat, observe real-time logs and traces
- [ ] `pnpm typecheck` and `pnpm -r test` pass

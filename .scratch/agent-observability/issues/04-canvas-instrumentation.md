# 04: Canvas Operation Instrumentation

**What to build:** Structured logging for canvas mutations (create, update, delete, undo, redo).

**Blocked by:** 01 (Observability Infrastructure)

**Status:** ready-for-agent

- [ ] Instrument `apps/daemon/src/paint/service.ts` — create, update, delete layer operations
- [ ] Instrument `apps/daemon/src/paint/service.ts` — undo and redo operations
- [ ] Log actor (`user` vs `agent`), revision, canvas ID, and layer ID for each operation
- [ ] Instrument `apps/daemon/src/api/routes.events.ts` — SSE subscribe/publish/disconnect events
- [ ] Integration tests for canvas operation logging
- [ ] `pnpm typecheck` and `pnpm -r test` pass

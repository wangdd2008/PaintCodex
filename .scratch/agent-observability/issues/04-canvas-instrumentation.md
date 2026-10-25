# 04: Canvas Operation Instrumentation

**What to build:** Structured logging for canvas mutations (create, update, delete, undo, redo).

**Blocked by:** 01 (Observability Infrastructure)

**Status:** done

- [x] Instrument `apps/daemon/src/paint/service.ts` — create, update, delete layer operations
- [x] Instrument `apps/daemon/src/paint/service.ts` — undo and redo operations
- [x] Log actor (`user` vs `agent`), revision, canvas ID, and layer ID for each operation
- [x] Instrument `apps/daemon/src/api/routes.events.ts` — SSE subscribe/publish/disconnect events
- [x] Integration tests for canvas operation logging
- [x] `pnpm typecheck` and `pnpm -r test` pass

## Comments

2026-10-25 — Implemented and merged into `feat/agent-observability`.

- Implementation commit: `327a284`, merge `f47f651`.
- Verification: `pnpm -r typecheck`, `pnpm -r test` (daemon 101, web 47), `pnpm -r build` all pass.
- Notes: instrumentation lives in `PaintService` only; `CommandDispatcher` is not instrumented so each mutation produces exactly one record. `sse_disconnect` is recorded best-effort because the database may close before the client socket tears down during shutdown.

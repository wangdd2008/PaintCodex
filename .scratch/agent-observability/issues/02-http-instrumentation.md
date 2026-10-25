# 02: HTTP Instrumentation

**What to build:** Automatic logging of all HTTP requests via Fastify hooks.

**Blocked by:** 01 (Observability Infrastructure)

**Status:** done

- [x] Wire `ObservabilityLogger` into Fastify `onRequest`/`onResponse` hooks in `apps/daemon/src/api/server.ts`
- [x] Log method, path, status code, duration for every request
- [x] Skip logging for `/monitor/events` SSE endpoint to avoid noise
- [x] Integration tests for HTTP logging
- [x] `pnpm typecheck` and `pnpm -r test` pass

## Comments

2026-10-25 — Implemented and merged into `feat/agent-observability`.

- Implementation commit: `ac79b54`, merge `fcaef3a`; metric semantics refined in `a0445d8`.
- Verification: `pnpm -r typecheck`, `pnpm -r test` (daemon 101, web 47), `pnpm -r build` all pass.
- Notes: 4xx maps to `warn`, 5xx to `error`; `/monitor/events` is skipped through the exported `shouldLogHttpRequest` predicate so the long-lived SSE request never creates an unfinished span.

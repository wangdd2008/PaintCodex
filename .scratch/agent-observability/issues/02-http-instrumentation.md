# 02: HTTP Instrumentation

**What to build:** Automatic logging of all HTTP requests via Fastify hooks.

**Blocked by:** 01 (Observability Infrastructure)

**Status:** ready-for-agent

- [ ] Wire `ObservabilityLogger` into Fastify `onRequest`/`onResponse` hooks in `apps/daemon/src/api/server.ts`
- [ ] Log method, path, status code, duration for every request
- [ ] Skip logging for `/monitor/events` SSE endpoint to avoid noise
- [ ] Integration tests for HTTP logging
- [ ] `pnpm typecheck` and `pnpm -r test` pass

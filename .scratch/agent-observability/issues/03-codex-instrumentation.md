# 03: Codex & AI Chat Instrumentation

**What to build:** Structured logging for Codex CLI lifecycle and AI chat request flow.

**Blocked by:** 01 (Observability Infrastructure)

**Status:** ready-for-agent

- [ ] Instrument `apps/daemon/src/paint/agent/codex-runner.ts` — spawn, delta, complete, error events
- [ ] Instrument `apps/daemon/src/api/routes.ai.ts` — prompt-built, codex-exec, action-parse, action-apply, sse-complete spans within a single trace
- [ ] Capture Codex CLI exit codes, stderr, timeouts, and aborts
- [ ] Integration tests for Codex logging (use fake runner seam)
- [ ] Integration tests for AI chat trace logging
- [ ] `pnpm typecheck` and `pnpm -r test` pass

# 03: Codex & AI Chat Instrumentation

**What to build:** Structured logging for Codex CLI lifecycle and AI chat request flow.

**Blocked by:** 01 (Observability Infrastructure)

**Status:** done

- [x] Instrument `apps/daemon/src/paint/agent/codex-runner.ts` — spawn, delta, complete, error events
- [x] Instrument `apps/daemon/src/api/routes.ai.ts` — prompt-built, codex-exec, action-parse, action-apply, sse-complete spans within a single trace
- [x] Capture Codex CLI exit codes, stderr, timeouts, and aborts
- [x] Integration tests for Codex logging (use fake runner seam)
- [x] Integration tests for AI chat trace logging
- [x] `pnpm typecheck` and `pnpm -r test` pass

## Comments

2026-10-25 — Implemented and merged into `feat/agent-observability`.

- Implementation commit: `3beffe2`, merge `dba87f7`; `action_apply` failure span finished in `a0445d8`.
- Verification: `pnpm -r typecheck`, `pnpm -r test` (daemon 101, web 47), `pnpm -r build` all pass.
- Notes: AI chat spans parent to the HTTP span when present; `codex-runner` events carry the trace through the optional fourth `run` argument. `chat_completed` is the single anchor for AI success statistics. Invalid request bodies intentionally produce no `chat_completed` record.

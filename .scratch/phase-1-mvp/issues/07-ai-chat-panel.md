# 07: AI Chat Panel

**What to build:** A collapsible AI chat panel on the right side where users can type natural language requests. The panel communicates with the Codex CLI via the daemon.

**Blocked by:** 01 (Project Scaffold)

**Status:** done

- [x] Backend: Spawn Codex CLI as a child process, communicate via stdin/stdout JSON
- [x] Backend: `POST /paint/ai/chat` endpoint accepts user prompt, forwards to Codex, streams response back
- [x] Frontend: Collapsible AI chat panel (right side, below layer panel)
- [x] Frontend: Chat UI with message bubbles (user input + AI response)
- [x] Acceptance: Type "Hello" in chat, receive a response from Codex within 10 seconds

## Comments

- 2026-10-25: Implemented in `b2db442` on `feat/phase-1-mvp`. The daemon uses an injectable `CodexRunner` seam (`apps/daemon/src/paint/agent/`) so tests never spawn Codex; `buildServer({ runner })` wires a fake for route tests. `POST /paint/ai/chat` returns `text/event-stream` (`x-accel-buffering: no`) with `data: {"delta":"..."}` frames, then `data: {"done":true}`; runner failures produce `data: {"error":{"code":"ai_chat_failed","message":"..."}}`. Missing/blank `message` → 400. Client disconnect aborts the runner and kills the child tree. Verified against the real CLI: Codex 0.164.0 JSONL emits `thread.started`, `turn.started`, `item.completed` (`error` / `agent_message`), and `turn.completed`; assistant text arrives as one `item.completed`/`agent_message` per turn (no token-level delta events), so the panel appends each message incrementally and stays ready for finer deltas. End-to-end SSE call through the real runner returned `pong` in 6.6s. Checks: `pnpm --filter @paintcodex/daemon test` (4 passed), `pnpm typecheck`, `pnpm build`.


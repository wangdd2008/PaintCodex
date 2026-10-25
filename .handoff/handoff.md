# Handoff: PaintCodex Phase 1 MVP Design Complete

> Generated: 2026-10-25
> Session focus: Architecture design → Spec → Tickets

## Project Status

PaintCodex is an AI-assisted painting application. This session completed the **architecture design** and **Phase 1 MVP spec** generation. **No code has been written yet.** The next session should begin implementing Ticket 01 (Project Scaffold).

## Key Decisions (Read: ADRs)

All architecture decisions were made via `/grill-with-docs` + `/domain-modeling`. The full decision tree is captured in:

- `docs/adr/0001-ai-generates-svg-only.md` — AI generates only SVG code
- `docs/adr/0002-codex-cli-local-process.md` — Codex CLI via local child process
- `docs/adr/0003-snapshot-undo.md` — Snapshot-level Undo/Redo for Phase 1
- `docs/adr/0004-sse-full-snapshot-push.md` — SSE pushes full snapshots

## Documents Generated

| File | Purpose |
|------|---------|
| `GLOSSARY.md` | Domain terminology (Canvas, Layer, Actor, Command Dispatcher, etc.) |
| `docs/adr/0001-ai-generates-svg-only.md` | AI code format decision |
| `docs/adr/0002-codex-cli-local-process.md` | Codex integration decision |
| `docs/adr/0003-snapshot-undo.md` | Undo/Redo strategy decision |
| `docs/adr/0004-sse-full-snapshot-push.md` | SSE strategy decision |
| `.scratch/phase-1-mvp/spec.md` | **Phase 1 MVP full spec** (read this first) |
| `.scratch/phase-1-mvp/issues/01-*.md` | Ticket 01: Project Scaffold |
| `.scratch/phase-1-mvp/issues/02-*.md` | Ticket 02: Canvas End-to-End |
| `.scratch/phase-1-mvp/issues/03-*.md` | Ticket 03: Brush Tool and Layer Persistence |
| `.scratch/phase-1-mvp/issues/04-*.md` | Ticket 04: Layer Panel |
| `.scratch/phase-1-mvp/issues/05-*.md` | Ticket 05: SSE Real-Time Sync |
| `.scratch/phase-1-mvp/issues/06-*.md` | Ticket 06: Snapshot-Level Undo/Redo |
| `.scratch/phase-1-mvp/issues/07-*.md` | Ticket 07: AI Chat Panel |
| `.scratch/phase-1-mvp/issues/08-*.md` | Ticket 08: AI Generates SVG → New Layer |
| `.scratch/phase-1-mvp/issues/09-*.md` | Ticket 09: PNG Export |

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React + TypeScript + Vite + Fabric.js + Zustand |
| Backend | Node.js + TypeScript + Fastify + better-sqlite3 |
| AI Engine | Codex CLI (local child process) |
| Build | pnpm workspace monorepo |

## Next Work: Ticket 01 — Project Scaffold

**Frontier:** Ticket 01 and Ticket 07 have no blockers and can start immediately.

**Recommended starting point:** Ticket 01 (Project Scaffold), because it is a prerequisite for almost everything else.

**Ticket 01 acceptance criteria:**
- `pnpm-workspace.yaml` defines `apps/*` and `packages/*` workspaces
- `apps/daemon/` is a working Fastify + TypeScript server (`pnpm dev`)
- `apps/web/` is a working React + Vite + TypeScript app (`pnpm dev`)
- `packages/protocol/` has shared TypeScript types
- Root `package.json` has common dev scripts
- `apps/web` includes Fabric.js and can render a blank canvas

## Suggested Skills for Next Agent

Call the Skill tool for:

- **`implement`** — To implement the current ticket based on its spec. The next agent should start with Ticket 01.
- **`tdd`** — If the next agent wants to build test-first (recommended for the Command Dispatcher and Service state machine).
- **`diagnosing-bugs`** — If build/runtime issues arise during implementation.
- **`code-review`** — After completing a ticket, review the changes against the spec.

## Notes

- **No code exists yet.** The repo only has `docs/` and `.scratch/` directories.
- **Issue tracker:** Local markdown under `.scratch/phase-1-mvp/issues/`.
- **Triage labels:** Standard five (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`) configured in `docs/agents/triage-labels.md`.
- **GitHub remote:** `https://github.com/wangdd2008/PaintCodex.git`
- **OS:** Windows 11 (23H2), PowerShell

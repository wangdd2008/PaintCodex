# PaintCodex

AI-assisted painting in the browser: a React + Fabric.js canvas, a local Fastify daemon, and a Codex CLI agent that draws by adding SVG layers.

Phase 1 is a single-canvas MVP with brush strokes, layers, snapshot undo/redo, real-time multi-client sync, AI-generated SVG layers, and PNG export.

## Quick start

Requirements:

- Node.js 22+
- pnpm 12 (pinned by `packageManager`)
- Codex CLI on `PATH`, signed in (needed only for AI chat)

```bash
pnpm install
pnpm dev
```

`pnpm dev` starts both processes:

- Web: http://localhost:5173
- Daemon: http://127.0.0.1:3210 (`GET /health` → `{"ok":true}`)

Open the web URL, click **New Canvas**, and draw. A brush stroke should survive a page refresh.

## How it works

```text
React + Fabric.js ── HTTP / SSE ──> Fastify daemon ──> SQLite (better-sqlite3)
                                         │
                                         └── child process ──> codex CLI
```

**Human–machine equality.** Users and the AI mutate the canvas through the same `CommandDispatcher`, distinguished only by `actor: 'user' | 'agent'`. Every mutation bumps the canvas revision and publishes a `snapshot_changed` event.

**Layers own their content.** A layer stores either a Fabric path (`kind: 'fabric'`) or SVG markup (`kind: 'svg'`); the shared contract lives in `packages/protocol/src/index.ts`.

**Snapshot undo/redo.** Each mutation stores the full `CanvasDocument`; the newest 20 states are retained. Undo/redo restore a state and bump the revision without appending a snapshot. See [ADR-0003](docs/adr/0003-snapshot-undo.md).

**Full-snapshot SSE.** Clients receive only a change signal, then refetch `GET /paint/canvas/:id`; there are no incremental patches. See [ADR-0004](docs/adr/0004-sse-full-snapshot-push.md).

**SVG-only AI.** Codex never executes canvas code. It returns prose plus `<<<CANVAS_ACTION>>>` and one JSON object; the daemon validates the SVG, then dispatches `canvas_create_layer` as `agent`. See [ADR-0001](docs/adr/0001-ai-generates-svg-only.md) and `apps/daemon/src/paint/agent/canvas-action.ts`.

## Project layout

```text
apps/daemon/          Fastify API, SQLite storage, CommandDispatcher, Codex adapter
apps/web/             React + Vite + Fabric.js + Zustand UI
packages/protocol/    Shared TypeScript contracts (Canvas, Layer, actions, SSE)
docs/                 Architecture background, ADRs, agent workflow docs
.scratch/             Phase 1 spec and ticket tracker
```

## API at a glance

| Endpoint | Purpose |
|---|---|
| `GET /health` | Liveness check |
| `POST /paint/canvas` | Create a canvas |
| `GET /paint/canvas/:id` | Read a canvas with its layers and history flags |
| `POST /paint/canvas/:id/layers` | Create a layer |
| `PATCH /paint/canvas/:id/layers/:layerId` | Update name, visibility, opacity, or content |
| `DELETE /paint/canvas/:id/layers/:layerId` | Delete a layer |
| `POST /paint/canvas/:id/apply-action` | Apply a dispatcher action (`user` or `agent`) |
| `POST /paint/canvas/:id/undo` · `/redo` | Move through snapshot history |
| `GET /paint/canvas/:id/events` | SSE stream of `snapshot_changed` |
| `POST /paint/ai/chat` | Stream a Codex response; may create an SVG layer |

The full request/response contract is in [`.scratch/phase-1-mvp/spec.md`](.scratch/phase-1-mvp/spec.md) and `packages/protocol/src/index.ts`; route implementations are in `apps/daemon/src/api/`.

Writes accept an optional `expectedRevision`. A stale value returns `409 revision_conflict`; brush layer creation refreshes and retries once, while other writes surface the error.

## Configuration

| Variable | Default | Applies to |
|---|---|---|
| `PORT` | `3210` | Daemon |
| `HOST` | `127.0.0.1` | Daemon |
| `PAINTCODEX_DB` | `data/paintcodex.db` under the daemon cwd | Daemon |

The SQLite file is gitignored. Vite proxies `/paint` and `/health` to `127.0.0.1:3210`; update `apps/web/vite.config.ts` if you move the daemon port.

## Checks

```bash
pnpm -r test     # daemon + web unit/integration tests
pnpm build       # typecheck + production bundles
pnpm typecheck   # types only
```

There is no browser E2E suite yet; verify UI changes with `pnpm dev`.

## Phase 1 scope and deliberate limits

- PNG export renders on the client from the live Fabric canvas; `POST /paint/canvas/:id/export` is deferred. See [ADR-0005](docs/adr/0005-client-side-png-export.md).
- AI layers can be selected, moved, and scaled; changing color or shape means asking the AI for a new layer.
- Snapshot undo, full-snapshot SSE, and SVG-only AI are intentional Phase 1 choices, not unfinished incremental systems.
- Out of scope: `.aipaint` files, shapes/text/eraser/fill, layer reorder/merge, AI confirmation, Electron.
- Where `docs/architecture-design.md` differs from the spec or an ADR, the spec and ADR win.

## Documentation map

| If you want to… | Read |
|---|---|
| Understand behaviour and acceptance criteria | [`.scratch/phase-1-mvp/spec.md`](.scratch/phase-1-mvp/spec.md) |
| See why a design choice was made | [`docs/adr/`](docs/adr/) |
| Check domain vocabulary | [`GLOSSARY.md`](GLOSSARY.md) |
| Work a local ticket | [`.scratch/phase-1-mvp/issues/`](.scratch/phase-1-mvp/issues/) and [`docs/agents/issue-tracker.md`](docs/agents/issue-tracker.md) |
| See the original architecture background | [`docs/architecture-design.md`](docs/architecture-design.md) |
| Contribute as an agent | [`AGENTS.md`](AGENTS.md) and [`docs/agents/`](docs/agents/) |

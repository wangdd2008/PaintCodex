# 02: Canvas End-to-End

**What to build:** A user can create a new canvas (1920×1080, white background) and see it rendered in the browser. The canvas state is persisted in SQLite and survives page refresh.

**Blocked by:** 01 (Project Scaffold)

**Status:** done

- [x] SQLite schema for `canvases` table (id, name, width, height, backgroundColor, revision, createdAt, updatedAt)
- [x] Fastify API: `POST /paint/canvas` creates a new canvas, `GET /paint/canvas/:id` returns a canvas
- [x] Frontend: "New Canvas" button that calls the API
- [x] Frontend: Fabric.js renders a 1920×1080 white canvas when a canvas is loaded
- [x] Frontend: Zustand store manages current canvas state
- [x] Refreshing the page re-loads the same canvas from the database

## Comments

- 2026-10-25: Implemented in `c6ed2dc` on `feat/phase-1-mvp`. SQLite lives at `apps/daemon/data/paintcodex.db` (`PAINTCODEX_DB` overrides; tests use `:memory:`). `POST /paint/canvas` → 201, `GET /paint/canvas/:id` → 200/404 with `{ error: { code, message } }`. Browser-verified: New Canvas writes `?canvasId=…` and localStorage, reload restores the same document, Fabric renders two canvases at width 1920, console is clean. `pnpm --filter @paintcodex/daemon test` → 6 passed; `pnpm build` passes.

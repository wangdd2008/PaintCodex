# 03: Brush Tool and Layer Persistence

**What to build:** A user can select a brush tool, draw freehand strokes on the canvas, and each stroke is saved as a layer in the database. On refresh, the drawing is restored.

**Blocked by:** 02 (Canvas End-to-End)

**Status:** done

- [x] SQLite schema for `layers` table (id, canvasId, name, type, zIndex, visible, opacity, content JSON, createdAt)
- [x] Fastify API: `POST /paint/canvas/:id/layers`, `PATCH /paint/canvas/:id/layers/:layerId` (and `DELETE` for Ticket 04)
- [x] `CommandDispatcher` is the single mutation path; layer routes and `apply-action` both delegate to it
- [x] Canvas revision increments on every mutation; stale `expectedRevision` returns `409 revision_conflict`
- [x] Frontend: Brush tool in left toolbar (selectable)
- [x] Frontend: Mouse drag on canvas creates a freehand path (Fabric.js `Path`)
- [x] Frontend: On mouse up, the path is saved as a new layer via API (serialised save queue keeps revisions ordered)
- [x] Frontend: Fabric.js re-renders all layers on load — per-layer `util.enlivenObjects` rather than one `loadFromJSON`, because layers are stored individually
- [x] Acceptance: Draw a line, refresh page, the line is still there

## Comments

- 2026-10-25: Implemented in `6211136` on `feat/phase-1-mvp`. Layer content is `{ kind: 'fabric', json }` or `{ kind: 'svg', svg }`; metadata records `createdBy`. Browser-verified: drag → layer panel shows `Stroke 1`; reload → 7711 non-white pixels on `.lower-canvas`; `GET /paint/canvas/:id` returns revision 1 with the Fabric Path. `pnpm --filter @paintcodex/daemon test` → 14 passed; `pnpm build` passes.

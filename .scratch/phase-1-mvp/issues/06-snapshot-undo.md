# 06: Snapshot-Level Undo/Redo

**What to build:** Users can undo and redo their actions via Ctrl+Z / Ctrl+Y or toolbar buttons. The last 20 states are retained in SQLite.

**Blocked by:** 03 (Brush Tool and Layer Persistence)

**Status:** done

- [x] SQLite schema for `snapshots` table (id, canvasId, revision, state JSON, actor, action, timestamp)
- [x] Backend: `applyAction` saves a complete snapshot after each mutation (limit 20 per canvas). Phase 1 snapshots the full `CanvasDocument` (canvas + layers + per-layer Fabric/SVG content) rather than one Fabric canvas JSON blob, because layers are persisted individually; restore semantics are equivalent.
- [x] Fastify API: `POST /paint/canvas/:id/undo`, `POST /paint/canvas/:id/redo`
- [x] Frontend: Undo/Redo buttons in toolbar (disabled when no history available)
- [x] Frontend: Keyboard shortcuts Ctrl+Z / Ctrl+Y work
- [x] Acceptance: Draw a line → Undo → the line disappears → Redo → the line reappears

## Comments

- 2026-10-25: Implemented in `ad5a412` on `feat/phase-1-mvp`. `canvases.undoCursorRevision` tracks the history cursor; new mutations truncate the redo branch; undo/redo bump the canvas revision and publish `snapshot_changed` without appending a snapshot. Retention keeps the newest 20 states. Browser-verified: two strokes → Ctrl+Z leaves `Stroke 1` → Ctrl+Y restores `Stroke 2`; two undos reach the empty canvas with Undo disabled; reload keeps the empty state with Redo available, and two Ctrl+Y restore both strokes. `pnpm --filter @paintcodex/daemon test` → 23 passed; `pnpm build` passes.

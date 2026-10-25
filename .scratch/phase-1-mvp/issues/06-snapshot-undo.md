# 06: Snapshot-Level Undo/Redo

**What to build:** Users can undo and redo their actions via Ctrl+Z / Ctrl+Y or toolbar buttons. The last 20 states are retained in SQLite.

**Blocked by:** 03 (Brush Tool and Layer Persistence)

**Status:** ready-for-agent

- [ ] SQLite schema for `snapshots` table (id, canvasId, revision, state JSON, actor, action, timestamp)
- [ ] Backend: `applyAction` saves a complete Fabric.js snapshot after each mutation (limit 20 per canvas)
- [ ] Fastify API: `POST /paint/canvas/:id/undo`, `POST /paint/canvas/:id/redo`
- [ ] Frontend: Undo/Redo buttons in toolbar (disabled when no history available)
- [ ] Frontend: Keyboard shortcuts Ctrl+Z / Ctrl+Y work
- [ ] Acceptance: Draw a line → Undo → the line disappears → Redo → the line reappears

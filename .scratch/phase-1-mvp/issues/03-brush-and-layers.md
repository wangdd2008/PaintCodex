# 03: Brush Tool and Layer Persistence

**What to build:** A user can select a brush tool, draw freehand strokes on the canvas, and each stroke is saved as a layer in the database. On refresh, the drawing is restored.

**Blocked by:** 02 (Canvas End-to-End)

**Status:** ready-for-agent

- [ ] SQLite schema for `layers` table (id, canvasId, name, type, zIndex, visible, opacity, content JSON, createdAt)
- [ ] Fastify API: `POST /paint/canvas/:id/layers`, `PATCH /paint/canvas/:id/layers/:layerId`
- [ ] Frontend: Brush tool in left toolbar (selectable)
- [ ] Frontend: Mouse drag on canvas creates a freehand path (Fabric.js `Path`)
- [ ] Frontend: On mouse up, the path is saved as a new layer via API
- [ ] Frontend: Fabric.js re-renders all layers on load using `loadFromJSON`
- [ ] Acceptance: Draw a line, refresh page, the line is still there

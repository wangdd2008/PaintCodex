# 04: Layer Panel

**What to build:** A right-side panel shows all layers for the current canvas. Users can toggle layer visibility and delete layers.

**Blocked by:** 03 (Brush Tool and Layer Persistence)

**Status:** done

- [x] Frontend: Right panel displays a list of layers with names and visibility toggle icons
- [x] Frontend: Clicking the eye icon toggles layer visibility (updates database + re-renders canvas)
- [x] Frontend: Clicking the trash icon deletes a layer (with confirmation dialog)
- [x] Frontend: Active layer is visually highlighted in the panel
- [x] Fastify API: `DELETE /paint/canvas/:id/layers/:layerId`

## Comments

- 2026-10-25: Implemented in `865aec6` on `feat/phase-1-mvp`. `CanvasStage` now reconciles the Fabric object map against `canvas.layers` (add/update visibility/remove) and tags locally drawn paths so saves do not duplicate strokes. Browser-verified on a persisted canvas: visibility toggle 7711 → 0 non-white pixels and survives reload; delete (confirm accepted) drops the layer, canvas returns to 0 pixels, and reload shows "No layers yet." `pnpm build` passes; the layer PATCH/DELETE API tests from Ticket 03 remain green.

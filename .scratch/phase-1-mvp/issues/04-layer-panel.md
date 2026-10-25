# 04: Layer Panel

**What to build:** A right-side panel shows all layers for the current canvas. Users can toggle layer visibility and delete layers.

**Blocked by:** 03 (Brush Tool and Layer Persistence)

**Status:** ready-for-agent

- [ ] Frontend: Right panel displays a list of layers with names and visibility toggle icons
- [ ] Frontend: Clicking the eye icon toggles layer visibility (updates database + re-renders canvas)
- [ ] Frontend: Clicking the trash icon deletes a layer (with confirmation dialog)
- [ ] Frontend: Active layer is visually highlighted in the panel
- [ ] Fastify API: `DELETE /paint/canvas/:id/layers/:layerId`

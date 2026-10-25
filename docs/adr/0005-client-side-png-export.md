# ADR-0005: Client-Side PNG Export

## Status

Accepted — Phase 1

## Context

Phase 1 must let a user export the current canvas as a PNG file. The architecture document sketches `canvas.toDataURL('png')` as the export mechanism and the original ticket proposed a `POST /paint/canvas/:id/export` daemon route.

Fabric.js runs its renderer in the browser. Calling `toDataURL` (or `toCanvasElement`) from Node requires `node-canvas`, a native addon with a C++ toolchain and prebuilt-binary guesswork. The team develops on Windows 11, where that dependency is the most fragile part of the install, and no other Phase 1 feature needs it.

The browser already holds the authoritative, live Fabric canvas that the user is looking at.

## Decision

Phase 1 exports PNG **client-side**, directly from the live Fabric canvas:

- `apps/web/src/services/canvas-engine.ts` holds the active Fabric `Canvas` (`setActiveCanvas`, `exportActiveCanvasPng`).
- `CanvasStage` registers the canvas on mount and clears it on cleanup.
- The App header's **Export PNG** action calls `canvas.toDataURL({ format: 'png', multiplier: 1 })`, converts the data URL to a `Blob`, downloads it as `<canvas name>.png` (sanitised, `paintcodex.png` fallback) and revokes the object URL.

No daemon export route is added in Phase 1. `POST /paint/canvas/:id/export` is deferred.

## Consequences

- **Positive**: No native dependency (`node-canvas`) in the workspace, so installs and CI stay portable on Windows/macOS/Linux.
- **Positive**: Export is WYSIWYG — it captures exactly the objects, opacity, and background currently rendered, including AI-generated SVG layers.
- **Positive**: No new API surface, no blob storage, no daemon-side rendering path to keep in sync.
- **Negative**: Export requires an open browser tab with a mounted canvas. Headless or agent-driven export (e.g. CI snapshots) is not possible without a browser harness.
- **Negative**: Export resolution is tied to the Fabric canvas settings; very large canvases are bounded by browser canvas limits.
- **Trade-off**: Server-side export remains available later behind the same deferred endpoint if agents need to export without a browser.

## Alternatives Considered

| Alternative | Rejected Because |
|---|---|
| `node-canvas` in the daemon | Native addon; requires a C++ toolchain and reliable prebuilt binaries. Fragile on Windows and unnecessary for one feature. |
| `resvg` (Rust SVG renderer via WASM/N-API) | Would require serialising the whole Fabric document to SVG first, so raster layers, blend modes, and brush textures would not match the screen. |
| Headless browser (Playwright) in the daemon | Correct output, but adds a browser download and a second rendering environment to the daemon for Phase 1. |
| Keep export deferred to Phase 2 | Export is an explicit Phase 1 goal and acceptance criterion; the client-side path is small enough to ship now. |

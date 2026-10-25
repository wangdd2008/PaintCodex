# 09: PNG Export

**What to build:** Users can export the current canvas as a PNG image file.

**Blocked by:** 02 (Canvas End-to-End)

**Status:** done

- [x] Frontend: `canvas-engine` service holds the active Fabric canvas and exposes `exportActiveCanvasPng()`
- [x] `CanvasStage` registers the canvas on mount and clears it on cleanup
- [x] Frontend: "Export PNG" button in the menu bar, enabled only when a canvas document is loaded
- [x] Frontend: clicking the button converts the data URL to a Blob and downloads `<canvas name>.png` (sanitised name, `paintcodex.png` fallback, object URLs revoked)
- [x] Client-side export only: `POST /paint/canvas/:id/export` and the node-canvas backend are deferred per [ADR-0005](../../docs/adr/0005-client-side-png-export.md)
- [x] Tests: Vitest in `apps/web` covers filename sanitisation and data-URL → Blob decoding
- [x] Acceptance: Export a canvas with a drawing, open the downloaded PNG, it matches what was on screen

## Comments

**2026-10-25 — implementation commit `78487ca`**

- Decision: export runs in the browser from the live Fabric canvas. A daemon route would need `node-canvas` (native, Windows-fragile), so it is deferred per ADR-0005.
- Files: `apps/web/src/services/canvas-engine.ts`, `apps/web/src/services/png-export.ts`, `apps/web/src/app/App.tsx`, `apps/web/src/features/canvas/CanvasStage.tsx`, `apps/web/test/png-export.test.ts`, `docs/adr/0005-client-side-png-export.md`, spec Export note.
- Tests: `pnpm --filter @paintcodex/web test` → 7/7 passed; `pnpm build` → protocol, daemon and web builds passed.
- Browser verification (agent-browser, session `png-export`): created a canvas, drew one brush stroke (layer count 1), clicked Export PNG. `window.__paintcodexPngExport` (dev-only hook) reported `data:image/png;base64,` with a valid `89 50 4e 47 0d 0a 1a 0a` signature, 1920×1080, 59,587 bytes, filename `Untitled.png`. Decoding the payload in-page and counting dark pixels found 3,562 non-white stroke pixels, so the drawing is in the exported image.

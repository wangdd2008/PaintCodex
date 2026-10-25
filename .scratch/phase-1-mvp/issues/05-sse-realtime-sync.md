# 05: SSE Real-Time Sync

**What to build:** When a canvas is modified (new layer, layer deleted, layer updated), all connected clients see the change immediately via SSE.

**Blocked by:** 03 (Brush Tool and Layer Persistence)

**Status:** done

- [x] Backend: SSE endpoint `/paint/canvas/:id/events` that clients can subscribe to
- [x] Backend: `events.publish()` is called after every mutation to broadcast `snapshot_changed`
- [x] Frontend: `EventSource` subscribes to SSE on canvas load
- [x] Frontend: On `snapshot_changed` event, re-fetch the full canvas from `GET /paint/canvas/:id` and re-render
- [x] Acceptance: Open two browser tabs with the same canvas; drawing in one tab shows up in the other within 1 second

## Comments

- 2026-10-25: Implemented in `6c83a06` on `feat/phase-1-mvp`. `PaintEvents` is an in-process per-canvas bus; `applyAction` publishes after the revision bump and the SSE route hijacks the reply with heartbeats. The client subscribes per canvas, refetches on `open` (covers reconnects) and whenever `revision > local revision` (skips its own echo). Browser-verified with two sessions on one canvas: session A drew a stroke, session B showed `Stroke 1` without reload and rendered 7711 non-white pixels. `pnpm --filter @paintcodex/daemon test` → 16 passed; `pnpm build` passes.

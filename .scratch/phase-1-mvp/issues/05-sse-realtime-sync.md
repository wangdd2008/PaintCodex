# 05: SSE Real-Time Sync

**What to build:** When a canvas is modified (new layer, layer deleted, layer updated), all connected clients see the change immediately via SSE.

**Blocked by:** 03 (Brush Tool and Layer Persistence)

**Status:** ready-for-agent

- [ ] Backend: SSE endpoint `/paint/canvas/:id/events` that clients can subscribe to
- [ ] Backend: `events.publish()` is called after every mutation to broadcast `snapshot_changed`
- [ ] Frontend: `EventSource` subscribes to SSE on canvas load
- [ ] Frontend: On `snapshot_changed` event, re-fetch the full canvas from `GET /paint/canvas/:id` and re-render
- [ ] Acceptance: Open two browser tabs with the same canvas; drawing in one tab shows up in the other within 1 second

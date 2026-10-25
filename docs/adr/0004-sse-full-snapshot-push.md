# ADR-0004: SSE Pushes Full Snapshots (Not Incremental Events)

## Status

Accepted (Phase 1). Subject to review in Phase 3.

## Context

When the canvas state changes (via user action or AI tool call), the daemon needs to notify connected frontend clients. Two strategies: push incremental events (e.g., `layer_added`, `layer_updated`) or push a signal to reload the full snapshot.

## Decision

The daemon publishes a lightweight `snapshot_changed` event via SSE. The frontend receives the event and performs a full `GET /paint/canvas/:id` to fetch the latest complete state, then re-renders the Fabric.js canvas.

## Consequences

- **Positive**: Frontend logic is trivial — no need to handle incremental merges or resolve conflicts.
- **Positive**: Guarantees frontend consistency with the server state.
- **Negative**: Higher network traffic, especially for large canvases.
- **Negative**: Potential UI flicker during full re-render.
- **Trade-off**: Accepted network overhead for correctness and simplicity.

## Migration Path

Phase 3 will evaluate incremental event pushing (`layer_added`, `layer_removed`, `layer_updated`) to reduce bandwidth and improve perceived performance.

# ADR-0003: Snapshot-Level Undo/Redo for Phase 1

## Status

Accepted (Phase 1). Subject to review in Phase 3.

## Context

The Undo/Redo system needs an implementation strategy. Two approaches were considered: (1) storing complete serialized snapshots after each operation, or (2) recording operations in a Command Pattern and reversing them on undo.

## Decision

For Phase 1, use **complete snapshot serialization** via Fabric.js's `canvas.toJSON()` / `canvas.loadFromJSON()`. Snapshots are stored in SQLite with a retention limit of 20 per canvas.

## Consequences

- **Positive**: Extremely simple to implement — one method call to serialize, one to restore.
- **Positive**: Guaranteed consistency — the entire canvas state is captured.
- **Negative**: High memory and storage usage for large canvases with many raster layers.
- **Negative**: Cannot selectively undo a single layer change without reverting the entire canvas.
- **Trade-off**: Accepted the storage cost for implementation simplicity in Phase 1. Phase 3 will migrate to Command Pattern.

## Migration Path

Phase 3 will introduce Command Pattern with operations like `AddLayer`, `MoveLayer`, `DeleteLayer`. Snapshots will be retained as a fallback mechanism.

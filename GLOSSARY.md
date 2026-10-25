# PaintCodex Glossary

## Core Concepts

### Canvas
The primary drawing surface. In PaintCodex, a canvas has fixed dimensions (1920×1080 by default), a background color, and a stack of layers.

### Layer
An individual drawable element within a canvas. Layers can be raster (imported images), vector (Fabric.js brush paths and other vector objects), or AI-generated (SVG code produced by Codex). Each layer has properties like opacity, visibility, and z-index.

### Actor
The entity that initiates an action. Either `user` (human) or `agent` (AI). Both actors use the same `applyAction` interface — this is the "human-machine equality" principle.

### Command Dispatcher
The single entry point for all canvas mutations. Receives `(action, input, actor)` and routes to the service state machine. Does not distinguish between human and AI operations.

### Snapshot
A complete serialized copy of the canvas state at a specific point in time. Used for Undo/Redo. Stored in SQLite with a retention limit of 20 per canvas.

### Revision
An integer version number attached to each canvas state. Used for optimistic concurrency control — if two actors modify the same revision, a `RevisionConflictError` is thrown.

### SSE (Server-Sent Events)
The real-time communication channel from daemon to frontend. Publishes `snapshot_changed` events whenever the canvas state mutates, regardless of the actor.

## AI-Specific Concepts

### Codex CLI
The local OpenAI Codex command-line tool invoked as a child process by the daemon. Generates SVG code in response to natural language prompts.

### Context Builder
The component that serializes the current canvas state (dimensions, layers, selected region) into a JSON structure consumed by Codex as context.

### AI-Generated Layer
A layer whose content is SVG code produced by Codex. Distinguished by `type: 'ai-generated'` and includes metadata about the original prompt. AI layers can be selected, moved, and scaled with the Select tool; transforms are written back as SVG content.

## Data Concepts

### Fabric JSON
The native serialization format of Fabric.js objects. Stored in the `json` field of a layer's `LayerContent`; snapshots embed the serialized canvas document.

### .aipaint (File Format)
The proprietary workspace file format (deferred to Phase 2). Will contain the full canvas document including layers, history, and metadata.

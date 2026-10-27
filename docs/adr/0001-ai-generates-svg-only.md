# ADR-0001: AI Generates SVG Code Only

## Status

Accepted — amended by [ADR-0009](/docs/adr/0009-ai-drives-canvas-through-codex-dynamic-tools.md): the SVG is now produced through a `canvas_create_layer` tool call instead of an inline `<<<CANVAS_ACTION>>>` payload. The SVG-only rule itself is unchanged.

## Context

The architecture document initially proposed that AI could generate both Canvas 2D API code and SVG code. However, this would require maintaining two rendering pipelines and a safe code execution environment (e.g., iframe + eval) for Canvas API code.

## Decision

AI will generate **only SVG code**. The `ai-code` layer type stores an SVG string, which Fabric.js can directly render via `fabric.loadSVGFromString()`.

## Consequences

- **Positive**: No need for a sandboxed eval environment. SVG is declarative and safe to parse.
- **Positive**: AI-generated layers are fully vector-based and remain editable (color, size, shape).
- **Negative**: AI cannot generate complex raster effects (gradients, filters) that are easier to express in Canvas 2D API.
- **Trade-off**: Lost the flexibility of Canvas 2D API, but gained simplicity and safety.

## Alternatives Considered

| Alternative | Rejected Because |
|---|---|
| Support both Canvas 2D and SVG | Requires eval sandbox, increases attack surface, complicates rendering pipeline |
| Canvas 2D only | Harder to convert to Fabric.js objects; requires more complex AI prompts |

# 08: AI Generates SVG → New Layer

**What to build:** When a user asks the AI to draw something, the AI generates SVG code, which is automatically rendered as a new layer on the canvas. All other connected clients see the new layer in real time.

**Blocked by:** 03 (Brush Tool and Layer Persistence), 05 (SSE Real-Time Sync), 07 (AI Chat Panel)

**Status:** done

- [x] Backend: Codex is prompted to generate SVG code wrapped in a canvas action (`<<<CANVAS_ACTION>>>` + one JSON object; Phase 1 protocol for the spec's `canvas_create_layer` tool call)
- [x] Backend: `CommandDispatcher` processes the action with `actor='agent'` (one retry on revision conflict)
- [x] Backend: New layer created with `type: 'ai-generated'` and SVG content; unsafe SVG (script/event handler/foreignObject/image/external URL) is rejected
- [x] Frontend: Fabric.js renders the SVG using `loadSVGFromString` (via `CanvasStage`)
- [x] Frontend: New AI layer appears in the layer panel with a `✦ AI` badge; the chat bubble hides the machine-readable action
- [x] SSE: The `snapshot_changed` event propagates to all clients
- [x] Acceptance: Say "Draw a red circle" in chat → a red circle appears on the canvas as a new layer

## Comments

- 2026-10-25: Implemented in `ed84e84` on `feat/phase-1-mvp`. Real Codex 0.164.0 returned the prose + marker + valid SVG on the first attempt; the daemon created `AI — Red Circle` (`ai-generated`, revision 1) with `metadata.createdBy = agent` and the original prompt. Browser-verified: the layer panel shows `✦ AI` and `.lower-canvas` has 153,504 non-white pixels, matching a radius-220 circle. Tests: `pnpm --filter @paintcodex/daemon test` → 31 passed; `pnpm build` passes.

# 08: AI Generates SVG → New Layer

**What to build:** When a user asks the AI to draw something, the AI generates SVG code, which is automatically rendered as a new layer on the canvas. All other connected clients see the new layer in real time.

**Blocked by:** 03 (Brush Tool and Layer Persistence), 05 (SSE Real-Time Sync), 07 (AI Chat Panel)

**Status:** ready-for-agent

- [ ] Backend: Codex is prompted to generate SVG code wrapped in a `canvas_create_layer` tool call
- [ ] Backend: `CommandDispatcher` processes the tool call with `actor='agent'`
- [ ] Backend: New layer created with `type: 'ai-generated'` and SVG content
- [ ] Frontend: Fabric.js renders the SVG using `loadSVGFromString`
- [ ] Frontend: New AI layer appears in the layer panel with a special AI icon
- [ ] SSE: The `snapshot_changed` event propagates to all clients
- [ ] Acceptance: Say "Draw a red circle" in chat → a red circle appears on the canvas as a new layer

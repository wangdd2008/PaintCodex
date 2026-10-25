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

## UX Concepts

### Chat Step
AI Chat 流式响应中的进度步骤事件。后端在关键处理节点（`prompt_built`、`codex_exec`、`action_parse`、`action_apply`）通过 SSE 推送 `step` 消息，前端展示对应的用户可见文案（如 "AI 正在思考…"）。用于替代静态的 "Thinking…" 状态，提升用户对后台进度的感知。

### Clear Input
AI Chat 输入框旁的快捷功能。点击后清空当前 `textarea` 的草稿内容，按钮随即变为「撤销」，可恢复刚才的内容（仅支持撤销一次）。仅影响界面，不改变已发送的对话历史。

### Abort / Cancel
用户在 AI 处理过程中主动终止请求的机制。前端通过 `AbortController` 中断 SSE 连接，后端终止 Codex CLI 子进程。取消后 Assistant 消息区域显示「已取消」。

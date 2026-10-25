# Phase 1 MVP Spec

> PaintCodex Phase 1：单画布 + 画笔 + 图层 + AI 生成 SVG + PNG 导出

## Overview

PaintCodex Phase 1 delivers a working AI-assisted painting application with a single canvas, basic brush tool, layer management, AI-generated SVG layers, and PNG export. The application follows the "human-machine equality" architecture where both users and AI agents interact with the canvas through the same `CommandDispatcher` interface.

## Goals

1. A user can create a canvas, draw with a brush, and see their work persist across refreshes.
2. A user can see a list of layers, toggle visibility, and delete layers.
3. A user can chat with an AI agent that generates SVG code, which is rendered as a new editable layer.
4. A user can undo/redo their actions.
5. A user can export the canvas as a PNG image.

## Out of Scope (Phase 2+)

- `.aipaint` file format (proprietary workspace file)
- Full tool set (eraser, shapes, text, fill)
- Layer reordering/merging
- AI "smart confirmation" (all AI actions are auto-executed in Phase 1)
- Desktop (Electron) build
- Incremental SSE events (Phase 1 uses full snapshot reload)
- Command Pattern for Undo/Redo (Phase 1 uses snapshot-level)

## Architecture Decisions (ADRs)

- [ADR-0001: AI Generates SVG Code Only](/docs/adr/0001-ai-generates-svg-only.md)
- [ADR-0002: Codex CLI via Local Child Process](/docs/adr/0002-codex-cli-local-process.md)
- [ADR-0003: Snapshot-Level Undo/Redo for Phase 1](/docs/adr/0003-snapshot-undo.md)
- [ADR-0004: SSE Pushes Full Snapshots](/docs/adr/0004-sse-full-snapshot-push.md)

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React + TypeScript + Vite + Fabric.js + Zustand |
| Backend | Node.js + TypeScript + Fastify + better-sqlite3 |
| AI Engine | Codex CLI (local child process) |
| Build | pnpm workspace monorepo |
| Testing | Vitest (optional for Phase 1) |

## Data Model

### SQLite Schema

```sql
-- canvases table
CREATE TABLE canvases (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  width INTEGER DEFAULT 1920,
  height INTEGER DEFAULT 1080,
  backgroundColor TEXT DEFAULT '#ffffff',
  revision INTEGER DEFAULT 0,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);

-- layers table
CREATE TABLE layers (
  id TEXT PRIMARY KEY,
  canvasId TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('raster', 'vector', 'ai-generated')),
  zIndex INTEGER NOT NULL,
  visible INTEGER DEFAULT 1,
  opacity REAL DEFAULT 1.0,
  content TEXT NOT NULL, -- Fabric JSON string
  metadata TEXT, -- JSON: { createdBy, createdAt, prompt? }
  createdAt INTEGER NOT NULL,
  FOREIGN KEY (canvasId) REFERENCES canvases(id) ON DELETE CASCADE
);

-- snapshots table
CREATE TABLE snapshots (
  id TEXT PRIMARY KEY,
  canvasId TEXT NOT NULL,
  revision INTEGER NOT NULL,
  state TEXT NOT NULL, -- Full Fabric JSON snapshot
  actor TEXT NOT NULL CHECK(actor IN ('user', 'agent')),
  action TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  FOREIGN KEY (canvasId) REFERENCES canvases(id) ON DELETE CASCADE
);
```

## API Endpoints

### Canvas

- `POST /paint/canvas` — Create a new canvas
- `GET /paint/canvas/:id` — Get canvas with all layers

### Layers

- `POST /paint/canvas/:id/layers` — Create a new layer
- `PATCH /paint/canvas/:id/layers/:layerId` — Update a layer
- `DELETE /paint/canvas/:id/layers/:layerId` — Delete a layer

### Actions

- `POST /paint/canvas/:id/apply-action` — Apply an action (used by both user and AI)
- `POST /paint/canvas/:id/undo` — Undo last action
- `POST /paint/canvas/:id/redo` — Redo last undone action

### Export

- `POST /paint/canvas/:id/export` — Export canvas as PNG

### AI

- `POST /paint/ai/chat` — Send a message to Codex, stream response

### SSE

- `GET /paint/canvas/:id/events` — SSE endpoint for real-time canvas updates

## UI Layout

```
┌─────────────────────────────────────────────────────────────┐
│  [菜单栏: New Canvas | Export PNG]                          │
├──────────────────────────────────────────────┬─────────────┤
│          │                                    │             │
│  工具    │         画 布 区 域               │  图层面板   │
│  ─────── │    ┌──────────────────────┐        │ ─────────── │
│  [画笔]  │    │                      │        │ 图层 1      │
│          │    │    Fabric.js         │        │ 图层 2 👁️   │
│          │    │    Canvas            │        │ AI-圆       │
│          │    │    (1920×1080)       │        │             │
│          │    │                      │        │             │
│          │    └──────────────────────┘        │ [AI 图标]   │
│          │                                    │  ─────────  │
│          │                                    │ AI 对话面板 │
│          │                                    │ [输入框]    │
├──────────────────────────────────────────────┴─────────────┤
│  [状态栏: 1920×1080 | Zoom: 100% | Brush]                   │
└─────────────────────────────────────────────────────────────┘
```

## AI Workflow

1. User types a prompt in the AI chat panel (e.g., "Draw a red circle")
2. Backend forwards the prompt to Codex CLI with system instructions and canvas context
3. Codex generates SVG code wrapped in a `canvas_create_layer` tool call
4. Backend calls `CommandDispatcher.applyAction({ actor: 'agent', action: 'canvas_create_layer', ... })`
5. Service creates a new layer with `type: 'ai-generated'` and SVG content
6. Service saves a snapshot to `snapshots` table
7. Service publishes `snapshot_changed` via SSE
8. Frontend receives SSE event, re-fetches canvas, re-renders all layers
9. New AI layer appears on canvas and in the layer panel

## Acceptance Criteria

- [ ] User can create a new canvas and see a 1920×1080 white canvas
- [ ] User can select the brush tool and draw freehand paths
- [ ] Drawn paths are saved as layers and survive page refresh
- [ ] User can see a list of layers in the right panel
- [ ] User can toggle layer visibility (eye icon)
- [ ] User can delete layers
- [ ] User can undo and redo actions (Ctrl+Z / Ctrl+Y)
- [ ] User can chat with AI and receive responses
- [ ] AI can generate SVG code that is rendered as a new layer on the canvas
- [ ] Multi-tab real-time sync works (changes in one tab appear in another)
- [ ] User can export the canvas as a PNG file

## Tickets

| # | Ticket | Blocked By |
|---|------|------------|
| 01 | [Project Scaffold](issues/01-project-scaffold.md) | None |
| 02 | [Canvas End-to-End](issues/02-canvas-end-to-end.md) | 01 |
| 03 | [Brush Tool and Layer Persistence](issues/03-brush-and-layers.md) | 02 |
| 04 | [Layer Panel](issues/04-layer-panel.md) | 03 |
| 05 | [SSE Real-Time Sync](issues/05-sse-realtime-sync.md) | 03 |
| 06 | [Snapshot-Level Undo/Redo](issues/06-snapshot-undo.md) | 03 |
| 07 | [AI Chat Panel](issues/07-ai-chat-panel.md) | 01 |
| 08 | [AI Generates SVG → New Layer](issues/08-ai-svg-to-canvas.md) | 03, 05, 07 |
| 09 | [PNG Export](issues/09-png-export.md) | 02 |

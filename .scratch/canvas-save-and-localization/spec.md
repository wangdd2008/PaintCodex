# 画布保存与中文本地化

## Problem Statement

当前 PaintCodex 存在两个问题：

1. **画布数据无法导出保存**：用户完成一幅作品后，虽然可以通过「导出 PNG」保存为图片，但图片是位图格式，丢失了图层、矢量信息等可编辑数据。用户无法将画布以 JSON 格式导出到本地，以便备份或在其他环境中恢复。
2. **UI 全部为英文**：整个应用的 UI 文案都是英文（如 Brush、Select、Undo、Send、Export PNG 等），对中文用户不够友好。且项目中已经混合了部分中文（AI Chat 面板中的"清空"、"撤销"、"取消"），文案风格不统一。

## Solution

### 画布 JSON 导出

新增「导出 JSON」功能，将当前画布的所有数据（画布元数据 + 所有图层内容）序列化为 JSON 文件并下载到本地。同时支持自动保存（每 30 秒自动导出一次 JSON）。

### UI 中文本地化

将应用中所有用户可见的英文文案统一改为中文，包括：前端 UI 按钮、菜单、状态栏、提示信息，以及后端返回的错误信息。

## User Stories

1. As a user, I want to export my canvas as a JSON file, so that I can back up the editable data including layers and vectors.
2. As a user, I want the JSON export to happen automatically at regular intervals, so that I don't lose work if I forget to save manually.
3. As a user, I want a manual "Export JSON" button in the menu bar, so that I can save on demand before important changes.
4. As a Chinese-speaking user, I want all UI labels to be in Chinese, so that I can understand the interface without reading English.
5. As a user, I want error messages to be in Chinese, so that I can understand what went wrong when something fails.
6. As a developer, I want the localization to be consistent across frontend and backend, so that the user experience is coherent.

## Implementation Decisions

### 1. JSON Export Format

The exported JSON will wrap the `CanvasDocument` with metadata:

```typescript
interface CanvasJsonExport {
  version: string;
  exportedAt: number;
  canvas: CanvasDocument;
}
```

This allows future versioning and import validation.

### 2. Auto-save Strategy

- Auto-save runs every 30 seconds via `setInterval` in `App.tsx`
- Only triggers when there is an active canvas
- Uses the same download mechanism as manual export
- Silent operation (no user-facing notification)

### 3. Localization Scope

**Frontend files to localize:**
- `App.tsx` — menu bar, status bar, button labels
- `Toolbox.tsx` — tool names, undo/redo labels
- `LayerPanel.tsx` — panel title, empty states, confirmation dialog
- `AiChatPanel.tsx` — send button, placeholder, role labels, empty state
- `MonitorPage.tsx` — monitoring UI labels
- `canvas-store.ts` — error messages
- `api.ts` — generic error messages

**Backend files to localize:**
- `errors.ts` — error class messages
- `routes.paint.ts` — validation errors, API error responses
- `routes.ai.ts` — AI-specific errors

### 4. No i18n Framework

Given the project's scope and the fact that it targets Chinese users only, we will hardcode Chinese strings directly rather than introducing an i18n framework. This keeps the codebase simple and avoids unnecessary complexity.

## Testing Decisions

- **Unit tests**: Add tests for `json-export.ts` utility functions (filename generation, data serialization)
- **Integration tests**: Verify that the "Export JSON" button triggers a download
- **Type check**: Ensure `pnpm -r typecheck` passes after all string changes
- **Visual verification**: Manually verify all UI elements display Chinese text correctly

Prior art: The existing `png-export.test.ts` tests filename sanitization and blob conversion. A similar test file `json-export.test.ts` will be created.

## Out of Scope

- JSON import/restore functionality (export only)
- Backend API for file storage (local download only)
- Multi-language support (i18n framework)
- Changing the AI prompt language (remains English for Codex CLI compatibility)
- Changing log/monitor internal labels (only user-facing UI is localized)

## Further Notes

- The auto-save interval of 30s is chosen to balance data safety and browser download spam. Users can adjust this later if needed.
- Error messages from the Codex CLI runner (e.g., timeout errors) will remain in English if they originate from the CLI, but the user-facing wrapper message will be in Chinese.
- The existing partial Chinese in `AiChatPanel.tsx` ("清空", "撤销", "取消") is already in the desired state; this spec extends that pattern to the entire app.

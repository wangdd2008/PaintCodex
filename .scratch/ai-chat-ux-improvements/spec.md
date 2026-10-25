# AI Chat UX Improvements — Clear Input & Step Progress

## Problem Statement

Phase 1 MVP 的 AI Chat 面板存在两个 UX 问题：

1. **输入框无法清空**：用户在输入较长 prompt 后，若临时想放弃，只能逐字删除，没有快捷清空方式。
2. **后台运行无进度感知**：AI 处理期间前端只显示静态的 "Thinking…"，用户不知道后台实际进行到哪一步（构建请求 → Codex 思考 → 解析结果 → 应用到画布），容易产生焦虑。同时，长时间运行时用户无法主动取消。

## Solution

对 AI Chat 面板进行两项 UX 增强：输入框清空功能，以及基于 SSE 步骤事件的进度说明。

### 清空输入框

在输入框旁增加一个「清空」按钮：仅清空当前 `textarea` 的草稿内容，不影响已发送的对话历史。清空后按钮变为「撤销」，点击可恢复刚才的内容（仅支持撤销一次）。无需确认弹窗，直接生效。

### AI 运行步骤说明

扩展 SSE 流式协议，在关键节点推送 `step` 事件，前端展示当前步骤文字。步骤包括：

- `prompt_built` → "正在构建请求…"
- `codex_exec` → "AI 正在思考…"
- `action_parse` → "正在解析结果…"
- `action_apply` → "正在应用到画布…"

发送按钮在 AI 运行期间变为「取消」，点击后触发 `AbortController.abort()` 终止请求。取消后显示「已取消」。

## User Stories

1. As a user writing a long AI prompt, I want to quickly clear the input field with a single click, so that I don't have to manually select and delete text when I change my mind.
2. As a user who has cleared the input by mistake, I want to undo the clear action with one click, so that I can recover my draft without retyping.
3. As a user waiting for AI response, I want to see which step the backend is currently on, so that I know the system is actually working and not frozen.
4. As a user waiting for AI response, I want to cancel the ongoing request with a Cancel button, so that I don't have to wait if the response is taking too long.
5. As a user who canceled a request, I want to see "Canceled" displayed in the assistant message area, so that I know the cancellation was successful.
6. As a user experiencing a slow AI response, I want to see a timeout message when the request exceeds 120 seconds, so that I know what happened and can retry.
7. As a developer, I want the SSE protocol to include step events, so that the frontend can render progress without polling.
8. As a developer, I want the cancel action to cleanly abort the Codex CLI child process, so that no orphaned processes remain.

## Implementation Decisions

### 1. SSE Protocol Extension

The existing `StreamPayload` type in `@paintcodex/protocol` will be extended with an optional `step` field:

```typescript
interface StreamPayload {
  delta?: unknown;
  done?: unknown;
  error?: { code?: unknown; message?: unknown };
  step?: { id: string; label: string };
  layerCreated?: { id: string; name: string };
}
```

The `step` event is emitted at the same points where observability spans are currently logged (`prompt_built`, `codex_exec`, `action_parse`, `action_apply`). This reuses existing seam points rather than introducing new ones.

### 2. Backend: Step Event Emission

In `routes.ai.ts`, the `send()` helper will be called with `step` payloads at these observability log points:

- After `buildAiChatPrompt()` completes → `{ step: { id: 'prompt_built', label: '正在构建请求…' } }`
- After `runner.run()` is invoked → `{ step: { id: 'codex_exec', label: 'AI 正在思考…' } }`
- After `parseCanvasAction()` completes → `{ step: { id: 'action_parse', label: '正在解析结果…' } }`
- Before `applyCanvasAction()` is called → `{ step: { id: 'action_apply', label: '正在应用到画布…' } }`

The existing `AbortController` mechanism for canceling the Codex runner is already in place; no changes needed there.

### 3. Frontend: Clear Input

A new state `lastInput` will be added to `AiChatPanel`. When the clear button is clicked:
1. `lastInput` is set to the current `input` value
2. `input` is cleared
3. The clear button swaps to an "Undo" button
4. Clicking "Undo" restores `lastInput` to `input` and resets `lastInput`

### 4. Frontend: Step Display

A new state `currentStep` will track the latest received `step` event. The step text will be displayed inside the assistant message bubble, above the actual content. The step text transitions with a CSS fade for smoothness.

The Send button will be conditionally rendered as "Cancel" (red) when `inFlight` is true. Clicking it calls `abortRef.current?.abort()`.

### 5. Testing Seams

- **Backend seam**: `apps/daemon/test/ai-chat.test.ts` — Fastify integration tests that verify SSE payloads include `step` events in the correct order.
- **Frontend seam**: A new `apps/web/test/ai-chat-panel.test.tsx` — React Testing Library tests for the clear/undo interaction and step rendering.

## Testing Decisions

- Only test external behavior, not implementation details. For example, test that the SSE stream contains the expected step events, not that `send()` is called with specific arguments.
- Backend tests: extend `ai-chat.test.ts` to assert on `step` event ordering and content.
- Frontend tests: create a new test file for `AiChatPanel` that tests clear/undo button toggling and step text rendering using React Testing Library.
- Prior art: `apps/daemon/test/ai-chat.test.ts` already tests SSE streaming with mocked `CodexRunner`.

## Out of Scope

- Keyboard shortcut for clearing input (e.g., Ctrl+K)
- Persisting draft input across page reloads
- Animating the step transitions beyond a simple CSS fade
- Expanding step granularity inside the Codex CLI (it remains a black box)
- Auto-retry on timeout or error

## Further Notes

- The `codex_exec` step may last 10–120 seconds depending on the prompt complexity. The "AI 正在思考…" text provides critical reassurance during this long-running phase.
- Canceling a request already cleanly terminates the Codex CLI process via `AbortController` → `terminate(child)`. This is existing behavior.
- The step labels are currently hardcoded in Chinese. If internationalization is added later, these should move to a locale file.

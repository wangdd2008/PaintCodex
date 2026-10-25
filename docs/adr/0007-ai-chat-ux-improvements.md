# ADR-0007: AI Chat UX Improvements — Clear Input & Step Progress

## Status

Accepted

## Context

Phase 1 MVP 的 AI Chat 面板存在两个 UX 问题：

1. **输入框无法清空**：用户在输入较长 prompt 后，若临时想放弃，只能逐字删除，没有快捷清空方式。
2. **后台运行无进度感知**：AI 处理期间前端只显示静态的 "Thinking…"，用户不知道后台实际进行到哪一步（构建请求 → Codex 思考 → 解析结果 → 应用到画布），容易产生焦虑。同时，长时间运行时用户无法主动取消。

## Decision

对 AI Chat 面板进行两项 UX 增强：输入框清空功能，以及基于 SSE 步骤事件的进度说明。

### 1. 清空输入框（Clear Input）

在输入框旁增加一个「清空」按钮：

- **作用范围**：仅清空当前 `textarea` 的草稿内容，不影响已发送的对话历史。
- **触发方式**：按钮点击，无键盘快捷键。
- **撤销支持**：清空后按钮变为「撤销」，点击可恢复刚才的内容（仅支持撤销一次）。
- **确认弹窗**：不需要，直接生效。

### 2. AI 运行步骤说明（Step Progress）

扩展 SSE 流式协议，在关键节点推送 `step` 事件，前端展示当前步骤文字。

#### 2.1 SSE 协议扩展

在现有 `StreamPayload` 中增加 `step` 字段：

```typescript
interface StreamPayload {
  delta?: unknown;
  done?: unknown;
  error?: { code?: unknown; message?: unknown };
  step?: { id: string; label: string };
  layerCreated?: { id: string; name: string };
}
```

#### 2.2 步骤映射

后端在以下日志节点对应发送 `step` 事件：

| 后端日志事件 | SSE Step 事件 ID | 用户可见文案 |
|---|---|---|
| `prompt_built` | `prompt_built` | 正在构建请求… |
| `codex_exec` 开始 | `codex_exec` | AI 正在思考… |
| `action_parse` | `action_parse` | 正在解析结果… |
| `action_apply` | `action_apply` | 正在应用到画布… |

`chat_completed` 时不发送额外 step，因为 `{ done: true }` 已标志流程结束。

#### 2.3 取消机制

- 发送按钮在 `inFlight` 期间变为「取消」（红色）。
- 点击后触发 `AbortController.abort()`，终止 SSE 连接及后端 Codex 进程。
- 取消后 Assistant 消息气泡内显示「已取消」。

#### 2.4 异常状态

| 场景 | 前端展示 |
|---|---|
| 失败 | 显示后端返回的错误信息（复用现有 `error` state） |
| 超时 | Codex CLI 120s 超时后显示「请求超时，请重试」 |
| 取消 | 显示「已取消」 |
| 未打开 Canvas | 复用现有 `canvas_required` error |

### 3. 涉及的文件

| 文件 | 改动 |
|---|---|
| `apps/web/src/features/ai-chat/AiChatPanel.tsx` | 新增清空按钮、撤销逻辑、步骤展示、Cancel 按钮 |
| `apps/web/src/features/ai-chat/ai-chat.css` | 新增步骤样式、清空按钮样式 |
| `apps/daemon/src/api/routes.ai.ts` | SSE 发送中增加 `step` 事件 |
| `packages/protocol/src/index.ts` | 扩展 `AiChatResponse` / `StreamPayload` 类型 |

## Consequences

- **Positive**：用户可快速清空输入，减少操作摩擦。
- **Positive**：步骤文字说明让用户了解 AI 当前状态，降低焦虑感。
- **Positive**：取消机制赋予用户控制权，避免长时间等待。
- **Negative**：SSE 协议扩展需要前后端协议同步，增加轻微维护成本。
- **Trade-off**：步骤粒度只到后端已有的日志节点，未深入到 Codex CLI 内部子步骤（如 "生成代码"、"验证 SVG"）。这是因为 Codex CLI 是黑盒进程，当前无法进一步拆分。

## Alternatives Considered

| Alternative | Rejected Because |
|---|---|
| 前端轮询后端状态端点获取步骤 | 增加额外 HTTP 请求，与现有 SSE 流式架构冲突 |
| 仅在 Codex 执行阶段显示进度条 | 无法覆盖 "构建请求" 和 "应用到画布" 等关键步骤 |
| 用 WebSocket 替代 SSE | SSE 已能满足需求，WebSocket 引入不必要的复杂度 |
| 取消按钮放在面板顶部 | 距离用户操作区过远，不如替换发送按钮直观 |

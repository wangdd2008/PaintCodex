# PaintCodex Glossary

## Core Concepts

### Canvas
The primary drawing surface. In PaintCodex, a canvas has fixed dimensions (1920×1080 by default), a background color, and a stack of layers.

### 画布文档（Canvas Document）
画布库中可被列出、打开、重命名和删除的那一张画布，携带自己的名称、尺寸、图层栈与修订号。它是持久化与寻址的单位。
_避免_: 画布（当指"某一张可管理的画布"时）、文件、项目

### 画布库（Canvas Library）
全部画布文档的集合，以及浏览、打开和删除它们的入口。它负责「找回」，不负责「写入」。
_避免_: 画布列表、画廊、文件列表

### Layer
An individual drawable element within a canvas. Layers can be raster (imported images), vector (Fabric.js brush paths and other vector objects), or AI-generated (SVG code produced by the agent). Each layer has properties like opacity, visibility, and z-index.

### Actor
The entity that initiates an action. Either `user` (human) or `agent` (AI). Both actors use the same `applyAction` interface — this is the "human-machine equality" principle. Equality is not substitution: the agent may only undo changes it made itself.

### Command Dispatcher
The single entry point for all canvas mutations. Receives `(action, input, actor)` and routes to the service state machine. Does not distinguish between human and AI operations.

### Snapshot
A complete serialized copy of the canvas state at a specific point in time, attributed to the actor that caused it. Used for Undo/Redo. Stored in SQLite with a retention limit of 20 per canvas.

### Revision
An integer version number attached to each canvas state. Used for optimistic concurrency control — if two actors modify the same revision, a `RevisionConflictError` is thrown.

### SSE (Server-Sent Events)
The real-time communication channel from daemon to frontend. Publishes `snapshot_changed` events whenever the canvas state mutates, regardless of the actor.

## AI-Specific Concepts

### Codex CLI
The local upstream command-line tool that provides the model runtime. It is a dependency of the daemon, not of the browser.

### Codex Runtime
The daemon component that owns the Codex process, the threads, and the turns. It is the only part of PaintCodex that speaks the Codex protocol, and therefore the only seam that has to change when that protocol does.

### Thread
A persistent conversation with Codex, one per canvas. The thread carries the memory that lets the agent understand "that circle" on a later message.

### Agent Turn
The work triggered by one user message: the model may converse, call tools, observe their results, and continue until it produces a final reply. A turn ends with a reply, an error, or a cancellation.

### Dynamic Tool
A canvas capability that PaintCodex declares to Codex when a thread starts, and that the model may invoke during a turn. The declared tools are the agent's entire ability to act on the canvas; anything not exposed as a tool, the agent cannot do.

### Tool Call
The model's request to run one dynamic tool, carrying arguments for it. Every tool call produces exactly one tool result.

### Tool Result
What a tool call returns to the model: whether it succeeded, plus content the model can read (text, and later rendered images). Failures are results too — the agent must be able to see them.

### Canvas Action
The single `PaintAction` that a tool dispatches through the Command Dispatcher. Tools map onto canvas actions; they are a new mouth, not a second throat.

### Context Builder
The component that produces the minimal prompt summary — canvas id, dimensions, revision, layer count. Anything finer-grained is pulled on demand through the context tool.

### AI-Generated Layer
A layer whose content is SVG produced by the agent. Tools may create it, rewrite its content, or delete it; its `metadata.createdBy` is always `agent`.

### Canvas Tool Set
The fixed, small list of tools the agent may call. It is deliberately smaller than the canvas's capabilities: additions need a decision, not a commit.

## Data Concepts

### Fabric JSON
The native serialization format of Fabric.js objects. Stored in the `json` field of a layer's `LayerContent`; snapshots embed the serialized canvas document.

### .aipaint (File Format)
The proprietary workspace file format (deferred to Phase 2). Will contain the full canvas document including layers, history, and metadata.

## UX Concepts

### Stream Event
One frame of the AI chat stream. Four kinds: `delta` (assistant text), `tool_call` / `tool_result` (agent acting on the canvas), `done` (turn finished). Replaced the fixed four-step progress (`Chat Step`) when the agent gained tools.

_避免_: Chat Step、进度条

### Write Action Line
The single chat line shown for a tool call that changes the canvas. Read-only tool calls are collapsed, because the user's question is always "did it touch my canvas", not "what did it read".

### Confirmation (AI Action)
An in-chat prompt that blocks a destructive tool (deleting a layer, exporting) until the user answers. It belongs to the tool layer, not to Codex's own approval policy.

### Clear Input
AI Chat 输入框旁的快捷功能。点击后清空当前 `textarea` 的草稿内容，按钮随即变为「撤销」，可恢复刚才的内容（仅支持撤销一次）。仅影响界面，不改变已发送的对话历史。

### Abort / Cancel
用户在 AI 处理过程中主动终止请求的机制。前端通过 `AbortController` 中断 SSE 连接，后端中断当前 turn。取消后 Assistant 消息区域显示「已取消」。

### 持久化（Persistence）
服务端把画布变更写入存储的行为；每次画布变更自动发生，用户不可关闭，且不产生本地文件。
_避免_: 保存、自动保存

### 导出（Export）
用户显式把画布内容下载为 PNG 或 JSON 文件的操作。它是备份，不承担保存职责，也不代表内容曾成功持久化。
_避免_: 保存、下载

### 保存状态（Save Status）
状态栏对最近一次持久化结果的可见反馈：保存中／已保存／保存失败。
_避免_: 自动保存、同步状态

### 无画布（No Canvas）
尚未创建、也没有任何已加载画布的状态。它没有可重试的对象，只能新建。
_避免_: 空画布、尚未加载

### 空画布（Empty Canvas）
已成功加载、但还没有任何图层的画布。它可以正常绘制。
_避免_: 无画布

### 加载失败（Load Failure）
已有画布标识、但读取画布内容失败的状态。它必须提供重试或新建入口，不能呈现为可交互画布。
_避免_: 无画布

### 连接状态（Connection Status）
画布页与 daemon 之间实时通道的健康度：连接中／实时中／重新连接中。
_避免_: 在线状态

### 选中图层（Active Layer）
图层面板中当前被选中的图层，画布据此定位或短暂高亮。它表示查看焦点，不表示绘制目标——一笔仍然只生成一个图层。
_避免_: 当前图层、活动图层

### 会话记录（Chat Transcript）
界面上一次对话往来的消息序列，与某一张画布文档绑定。它是会话态：刷新即失，不做跨会话恢复。
_避免_: 聊天历史、对话持久化、消息表

## Observability Concepts

### 追踪（Trace）
一个 `traceId` 下的全部 span 与事件，描述一次请求或一次对话从发起到结束的完整经过。
_避免_: 链路、调用链、日志组

### 消息（Message）
带有发出方与接收方的事件，方向形如 `浏览器 → Daemon`。它与 span（有耗时的区间）和内部事件（无方向）互斥。
_避免_: 日志、事件（当泛指一切记录时）

### 方向（Direction）
一条消息的发出方与接收方。只有消息有方向；span 与内部事件没有。
_避免_: 流向、来源

### 组件（Component）
参与消息往来的一个可命名实体：浏览器、Daemon、Codex app-server、模型、SQLite。前三个可直接观测，后两个由相邻组件代为标注。
_避免_: 服务、模块、分类（category 是日志的归类，不是组件）

### 拓扑（Topology）
组件与它们之间消息通道的固定关系图，用于解释「谁和谁说话」。它由代码声明，不因数据缺失而改变形状。
_避免_: 架构图（当指带实时数据的那个时）、依赖图

## Viewport Concepts

### 缩放（Viewport Zoom）
画布的显示比例与平移，只改变渲染视图，不改变文档坐标、图层内容或笔刷宽度。
_避免_: 画布尺寸、分辨率

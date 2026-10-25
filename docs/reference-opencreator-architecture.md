# OpenCreator 软件架构概述

> 本文档从"人机同权"和"AI 驱动"的视角梳理 OpenCreator 的软件架构。

## 一、项目定位

OpenCreator（原名 KrillinAI）是一个**面向创作者的开源 AI 工作空间**，提供可视化工具和 Agent 对话两种工作方式，支持视频翻译、图片生成、文章写作等创作任务。

核心设计理念：**"人机同权"**——人类用户和 AI Agent 共用同一套命令接口和状态机。

---

## 二、整体架构概览

```
┌─────────────────────────────────────────────────────────────┐
│  用户入口层（两种交互方式）                                    │
│  ┌──────────────┐    ┌──────────────┐                       │
│  │ 可视化界面    │    │ 自然语言对话  │                       │
│  │ (Web/Desktop)│    │ (Agent Chat) │                       │
│  └──────┬───────┘    └──────┬───────                       │
│         │                   │                               │
│         └─────────┬──────────                               │
│                   ▼                                          │
│         HTTP API + SSE (统一协议)                            │
└──────────────────┬──────────────────────────────────────────┘
                   │
┌──────────────────┼──────────────────────────────────────────┐
│  Daemon 服务层    │                                          │
│                  │                                           │
│  ┌───────────────▼─────────────────────────────┐             │
│  │         HTTP API 路由层                    │             │
│  │    /creator/jobs/:id/*                     │             │
│  └───────────────┬─────────────────────────────┘             │
│                  │                                           │
│  ┌───────────────▼─────────────────────────────┐             │
│  │      Command Dispatcher                     │             │
│  │  ┌─────────────────────────────────────────┐│             │
│  │  │  dispatch(action, input, actor)         ││             │
│  │  │  actor = 'user' | 'agent'                ││             │
│  │  └─────────────────────────────────────────┘│             │
│  └───────────────┬─────────────────────────────┘             │
│                  │                                           │
│  ┌───────────────▼─────────────────────────────┐             │
│  │       Creator Core (业务核心)               │             │
│  │  ┌───────── ┌─────────┐ ──────────┐     │             │
│  │  │ Service │ │Templates│ │Repository│     │             │
│  │  │ 状态机   │ │ 模板定义 │ │ 数据层    │     │             │
│  │  └─────────┘ └───────── └──────────┘     │             │
│  └─────────────────────────────────────────────┘             │
│                  │                                           │
│  ┌───────────────▼─────────────────────────────┐             │
│  │          Agent Layer (AI 适配层)             │             │
│  │  ┌────────── ┌──────────┐ ──────────┐   │             │
│  │  │ Context  │ │ Codex    │ │ Event    │   │             │
│  │  │ Builder  │ │ Adapter  │ │ Normalizer│   │             │
│  │  └──────────┘ └──────────┘ └──────────┘   │             │
│  └─────────────────────────────────────────────┘             │
│                  │                                           │
│  ┌───────────────▼─────────────────────────────┐             │
│  │       Runtime Manager (进程托管)             │             │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐   │             │
│  │  │ Codex    │ │ Stage    │ │ KrillinAI│   │             │
│  │  │ Runner   │ │ Runner   │ │ Pipeline │   │             │
│  │  └──────────┘ └──────────┘ └──────────┘   │             │
│  └─────────────────────────────────────────────┘             │
└──────────────────┬──────────────────────────────────────────┘
                   │
┌──────────────────┼──────────────────────────────────────────┐
│  数据层           │                                          │
│  ┌───────────────▼───────────────┐                           │
│  │  SQLite (状态、日志、版本)      │                           │
│  │  文件系统 (工作空间、Artifacts) │                           │
│  └───────────────────────────────┘                           │
└──────────────────────────────────────────────────────────────┘
```

---

## 三、核心层详解：Command Dispatcher 如何实现"人机同权"

### 3.1 统一入口

```typescript
// command-dispatcher.ts
function dispatch(action, input, actor) {
  // actor = 'user'  → 人类操作
  // actor = 'agent' → AI 操作
  
  return service.applyAction({
    actor,
    action,
    expectedRevision,
    input
  });
}
```

**关键设计**：不区分"人类 API"和"AI API"，只有**一个 `applyAction` 接口**。

### 3.2 状态机（Service）

```typescript
// service.ts
function applyAction(jobId, request) {
  const actor = request.actor ?? 'user';  // 默认是人类
  const current = getJob(jobId);
  
  // 乐观锁检查
  if (current.revision !== request.expectedRevision) {
    throw new RevisionConflictError();
  }
  
  // 执行状态转移
  const nextState = templateReducer(current, request);
  
  // 记录操作历史
  logActivity({
    actor,           // 'user' 或 'agent'
    action,
    revision,
    timestamp
  });
  
  return nextState;
}
```

**状态机是"无偏见的"**：它不关心操作者是谁，只关心"这个操作在当前状态下是否合法"。

### 3.3 模板系统（Templates）

每个创作模板定义了自己的：
- **阶段（Stages）**：如 `transcription → translation → dubbing`
- **动作（Actions）**：如 `run-stage`, `update-settings`, `undo-action`
- **状态转移规则**：什么阶段可以转移到什么阶段

---

## 四、AI 层详解：Codex 如何"驾驶"这个系统

### 4.1 上下文构建（Context Builder）

当用户用自然语言发起请求时：

```typescript
// context-builder.ts
function buildContext(job, selection) {
  return {
    jobId: job.id,
    templateId: job.templateId,
    currentStage: job.state.currentStage,
    stages: job.stages.map(...),      // 当前进度
    state: projectState(job.state),   // 当前设置
    recentChanges: job.activities,    // 最近操作
    focusedIssue: ...,                // 当前问题
    availableStageIds: template.stages.map(s => s.id)
  };
}
```

**把数据库状态"拍扁"成 AI 能懂的 JSON**。

### 4.2 Codex 适配器（Codex Adapter）

```typescript
// codex-adapter.ts
function startTurn(input) {
  return codexAppServer.start({
    prompt: creatorPrompt(input),           // 用户请求 + 上下文
    developerInstructions: instructions,    // 系统指令
    skills: [{ name: 'opencreator-runtime' }], // 工具集
    onNotification: (event) => { ... },      // 接收 AI 输出
    onApprovalRequest: (req) => { ... }     // 危险操作拦截
  });
}
```

### 4.3 工具调用（Skills）

AI 不直接操作数据库，而是通过**工具**间接操作：

```typescript
// opencreator-runtime skill 提供的工具
{
  "creator_get_context": "获取项目完整上下文",
  "creator_get_artifact": "读取大文本文件",
  "creator_apply_action": "执行修改操作（带乐观锁）",
  "run-stage": "启动异步阶段",
  "creator_wait_for_stage": "等待阶段完成"
}
```

**AI 的操作流**：
1. 用户说"帮我翻译这个视频"
2. AI 调用 `creator_get_context` 了解当前状态
3. AI 发现需要 `run-stage` 启动 `transcription`
4. AI 调用 `creator_apply_action` 提交操作（actor='agent'）
5. 系统执行状态转移，启动 KrillinAI 引擎
6. AI 等待结果，然后继续下一步

---

## 五、运行时层：谁来执行"脏活累活"

| 运行时 | 职责 | 触发者 |
|--------|------|--------|
| **Codex Runner** | 启动/托管 Codex 进程，stdin/stdout 通信 | Agent 层 |
| **Stage Runner** | 执行具体阶段（如调用 Whisper 转录） | Service 层 |
| **KrillinAI** | Go 实现的视频处理引擎（字幕、配音、渲染） | Stage Runner |

---

## 六、前端层：Web 与 Desktop 的统一

```
┌─────────────────────────────────────────┐
│           Desktop (Electron)            │
│  ┌─────────────────────────────────┐    │
│  │  Window / Tray / Native Notify  │    │
│  └──────────────┬──────────────────┘    │
│                 │                       │
│  ┌──────────────▼──────────────────┐    │
│  │   Host Bridge (Electron IPC)    │    │
│  │   - 目录选择                     │    │
│  │   - 文件拖拽                     │    │
│  │   - 系统通知                     │    │
│  └──────────────┬──────────────────┘    │
└─────────────────┼───────────────────────┘
                  │ 同一份 Web 构建产物
┌────────────────────────────────────────┐
│                 ▼                       │
│  ┌─────────────────────────────────┐  │
│  │        Web Frontend (React)       │  │
│  │  ┌───────────┐  ┌──────────────┐  │  │
│  │  │ 可视化工具 │  │ Agent 对话    │  │  │
│  │  │ (Creator  │  │ (Chat 界面)  │  │  │
│  │  │  Workspace)│  │              │  │  │
│  │  └───────────┘  └──────────────┘  │  │
│  └──────────────┬──────────────────┘  │
└─────────────────┼─────────────────────
                  │ HTTP + SSE
┌─────────────────▼─────────────────────┐
│           Daemon (Node.js)            │
│     Command Dispatcher + Service      │
└───────────────────────────────────────┘
```

**关键设计**：Web 是唯一的 UI 实现，Desktop 只是"加了壳的 Web"。

---

## 七、架构优势总结

| 设计原则 | 体现 |
|---------|------|
| **人机同权** | 人和 AI 共用同一套 `applyAction`，状态机不区分 actor |
| **AI 不触碰核心** | AI 只通过工具接口操作，不直接读写数据库 |
| **模板驱动** | 新增创作类型只需新增模板，无需改动核心 |
| **前后端分离** | 前端纯展示，所有业务逻辑在后端 |
| **多平台统一** | Web 和 Desktop 共用同一套前端代码 |
| **运行时解耦** | Codex 负责"智能"，KrillinAI 负责"执行" |

---

## 八、交付给 AI 的核心能力

| 能力 | 说明 |
|------|------|
| **用户意图理解** | 分析用户自然语言，识别隐含需求 |
| **任务规划** | 根据项目上下文决定执行哪个阶段 |
| **工具选择** | 决定调用哪个工具，生成正确参数 |
| **内容生成** | 生成文案、代码、配置、回答等 |
| **错误诊断** | 分析失败原因，给出修复建议 |
| **并发冲突处理** | 冲突后决定如何重试 |

---

## 九、一句话总结

> **OpenCreator 的架构核心是"把人机操作统一到同一个状态机"，Codex AI 只是另一个 actor，和人类用户一样通过 Command Dispatcher 操作业务。**

---

## 十、状态同步：操作结果如何实时反映到前端

### 10.1 统一的事件总线

后端通过 `apps/daemon/src/creator/events.ts` 维护了一个发布/订阅系统：

```typescript
const subscribers = new Map<string, Set<(event: CreatorEventEnvelope) => void>>();

function publish(input: { jobId: string; event: CreatorEventEnvelope }) {
  for (const subscriber of subscribers.get(input.jobId) ?? []) {
    subscriber(event);
  }
}

function subscribe(jobId: string, subscriber: (event: CreatorEventEnvelope) => void) {
  const listeners = subscribers.get(jobId) ?? new Set();
  listeners.add(subscriber);
  // ...
}
```

### 10.2 SSE 实时推送

前端通过 `/creator/jobs/:id/events` 端点建立 SSE 连接：

```typescript
// routes.creator.ts
reply.raw.writeHead(200, {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive'
});

const writeEvent = (event: CreatorEventEnvelope) => {
  reply.raw.write(formatSseEvent({ id: event.id, event: event.kind, data: event }));
};

const unsubscribe = events.subscribe(id, event => {
  writeEvent(event);
});
```

### 10.3 状态变更即发布事件

无论是人类操作还是 AI 操作，每次 `applyAction` 后都会触发 `events.publish()`：

```typescript
// 人类操作后（如上传视频）
events.publish({
  id: `snapshot:${response.job.revision}`,
  jobId: response.job.id,
  revision: response.job.revision,
  kind: 'snapshot_changed',
  payload: { revision: response.job.revision }
});
```

### 10.4 前端订阅处理

前端在 `apps/web/src/runtime/creator-sse.ts` 中统一订阅 SSE：

```typescript
export function createCreatorSnapshotSubscription<T, Event = unknown>(input: {
  loadSnapshot(options: { signal: AbortSignal }): Promise<T>;
  subscribe(onEvent: (event: Event) => void, onDisconnect: (error?: unknown) => void): { close(): void };
  onSnapshot(snapshot: T): void;
  onEvent?(event: Event): void;
  // ...
}) {
  // 连接SSE，收到事件后重新加载快照或更新状态
}
```

### 10.5 重连机制

SSE 支持通过 `last-event-id` 或 `cursor` 参数恢复连接，断线后前端可以获取错过的所有事件。

```
前端连接 → SSE /creator/jobs/:id/events
  ├─ 首次：发送完整 snapshot
  ├─ 断线重连：通过 last-event-id 补发事件
  └─ 持续：实时推送状态变更
```

### 10.6 关键结论

| 操作来源 | 触发路径 | 前端是否实时收到 |
|---------|---------|---------------|
| **人类用户** (Web/Desktop) | HTTP API → CommandDispatcher → Service → events.publish() | ✅ 是，通过 SSE |
| **AI Agent** (Codex) | Tool Call → CommandDispatcher → Service → events.publish() | ✅ 是，通过 SSE |

**核心设计**：状态变更是唯一的"真相之源"，无论谁触发了状态变更，都会通过统一的事件总线广播给所有订阅者（前端）。前端不需要关心操作者是人是AI，只需要订阅事件并刷新状态即可。

---

## 十一、项目目录结构详解

### 11.1 根目录概览

```
OpenCreator/                    # 项目根目录
├── apps/                       # 应用层（4个应用）
├── assets/                      # 静态资源（字体、语言包等）
├── docs/                        # 项目文档
├── packages/                    # 共享包（5个内部包）
├── resources/                   # 运行时资源
├── runtime/                     # 底层运行时（Go实现）
├── scripts/                     # 构建与开发脚本
├── skills/                      # 技能模块
├── template/                    # 创作模板
├── package.json                 # 根包配置（pnpm workspace）
├── pnpm-workspace.yaml          # pnpm工作区定义
└── ...
```

### 11.2 `apps/` — 应用层（4个应用）

```
apps/
├── daemon/          # 后端守护进程（Node.js/TypeScript）
│   ├── src/
│   │   ├── creator/       # 创作者核心（CommandDispatcher、状态机等）
│   │   ├── api/           # HTTP API路由（Fastify）
│   │   ├── codex/         # Codex AI运行时适配
│   │   ├── gateway/       # 网关层（OpenRouter等）
│   │   ├── scheduler/     # 任务调度
│   │   ├── storage/       # 数据存储（SQLite）
│   │   ├── workspace-files/ # 工作区文件管理
│   │   └── main.ts        # 入口文件
│   ├── test/
│   └── package.json
│
├── web/             # Web前端（React + Vite）
│   ├── src/
│   │   ├── app/           # 路由与页面
│   │   ├── features/      # 功能模块（按特性组织）
│   │   ├── services/      # API服务与状态管理
│   │   ├── runtime/       # 运行时连接（SSE等）
│   │   ├── components/    # 共享组件
│   │   └── main.tsx       # 入口
│   ├── e2e/             # Playwright端到端测试
│   └── package.json
│
├── desktop/         # Electron桌面应用
│   ├── src/             # 主进程代码
│   ├── e2e/             # 桌面端E2E测试
│   ├── packaging/       # 打包配置
│   └── package.json
│
└── harness/         # 开发/测试工具
    ├── src/
    └── package.json
```

**关系说明**：
- **`daemon`** 是整个系统的核心大脑，提供HTTP API和SSE事件流
- **`web`** 是唯一的UI实现，通过HTTP+SSE与daemon通信
- **`desktop`** 是Electron壳，内嵌web页面，额外提供系统级能力（文件选择、通知等）
- **`harness`** 是辅助开发工具

### 11.3 `packages/` — 共享包（5个内部包）

```
packages/
├── config/              # 共享配置（TypeScript、构建工具配置等）
├── protocol/            # 前后端共享协议（类型定义、接口契约）
├── skill-market/        # 技能市场（技能注册、发现、管理）
├── stickman-remotion/   # Remotion视频渲染相关
└── writing-templates/   # 写作模板定义
```

这些包被 `apps/*` 引用，确保前后端类型安全和代码复用。

### 11.4 `runtime/` — 底层运行时（Go实现）

```
runtime/
└── krillinai/           # Go实现的视频处理引擎
    ├── cmd/             # 命令行入口
    ├── internal/        # 内部实现
    ├── pkg/             # 可复用包
    ├── config/          # 配置文件
    └── go.mod           # Go模块定义
```

**职责**：负责视频转录、翻译、配音、字幕渲染等重计算任务，作为独立进程被 `daemon` 调用。

### 11.5 `skills/` — 技能模块

```
skills/
├── krillinai-cli/            # CLI技能
├── krillinai-cover/           # 封面生成
├── krillinai-pipeline/        # 流水线处理
├── krillinai-render-horizontal/ # 横屏渲染
├── krillinai-render-vertical/   # 竖屏渲染
├── krillinai-subtitle/        # 字幕处理
└── krillinai-tts/             # 语音合成
```

这些是 **KrillinAI（Go运行时）的技能插件**，每个技能对应视频处理的一个环节。

### 11.6 `assets/` — 静态资源

```
assets/
├── creator-languages/          # 创作者语言配置
├── creator-preset-video-sources/ # 视频预设资源
└── creator-subtitle-fonts/     # 字幕字体（桌面端/Web端）
```

### 11.7 `resources/` — 运行时资源

```
resources/
├── codex-runtime/        # Codex运行时环境
│   └── win32-x64/        # 平台特定二进制
└── stickman/             # Stickman角色资源
```

### 11.8 `scripts/` — 构建与开发脚本

```
scripts/
├── build-krillinai.mjs              # 构建Go运行时
├── check-performance-baseline.mjs     # 性能基线检查
├── download-go-modules.mjs          # 下载Go模块
├── generate-creator-languages.mjs    # 生成语言配置
├── package-krillinai-release.mjs     # 打包运行时
└── ...
```

### 11.9 `template/` — 创作模板

```
template/
├── cover-generator/      # 封面生成模板
├── image-generation/     # 图片生成模板（79个子模板）
└── video-generation/     # 视频生成模板（28个子模板）
```

---

## 十二、技术栈总结

| 层级 | 技术 |
|------|------|
| **前端** | React + TypeScript + Vite |
| **桌面** | Electron |
| **后端** | Node.js + TypeScript + Fastify |
| **AI引擎** | Codex CLI（OpenAI） |
| **视频处理** | Go（KrillinAI） |
| **数据库** | SQLite |
| **构建** | pnpm + TypeScript |
| **测试** | Vitest + Playwright |

---

## 十三、一句话概括

> 这是一个 **monorepo 架构** 的创作者工具平台：
> - **`apps/daemon`** 是大脑（Node.js + AI）
> - **`apps/web`** 是面孔（React + Vite）
> - **`apps/desktop`** 是外壳（Electron）
> - **`runtime/krillinai`** 是肌肉（Go视频引擎）
> - **`packages/*`** 是共享的神经系统（协议与配置）

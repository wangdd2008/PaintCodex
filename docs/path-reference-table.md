# OpenCreator -> PaintCodex 参考路径对照表（相对路径）

## 根配置

| OpenCreator | PaintCodex |
|---|---|
| package.json | package.json |
| pnpm-workspace.yaml | pnpm-workspace.yaml |
| tsconfig.base.json | tsconfig.base.json |
| playwright.config.ts | playwright.config.ts |

## Daemon 后端

| OpenCreator | PaintCodex | 说明 |
|---|---|---|
| apps/daemon/src/main.ts | apps/daemon/src/main.ts | 入口 14.5KB |
| apps/daemon/src/startup.ts | apps/daemon/src/startup.ts | 启动 5.0KB |
| apps/daemon/src/api/server.ts | apps/daemon/src/api/server.ts | Fastify 80.9KB |
| apps/daemon/src/api/sse.ts | apps/daemon/src/api/sse.ts | SSE 0.4KB |
| apps/daemon/src/api/routes.creator.ts | apps/daemon/src/api/routes.paint.ts | 路由 74.8KB |
| apps/daemon/src/creator/command-dispatcher.ts | apps/daemon/src/paint/command-dispatcher.ts | 核心 19.8KB |
| apps/daemon/src/creator/service.ts | apps/daemon/src/paint/service.ts | 状态机 65.1KB |
| apps/daemon/src/creator/repository.ts | apps/daemon/src/paint/repository.ts | 仓库 62.4KB |
| apps/daemon/src/creator/events.ts | apps/daemon/src/paint/events.ts | 事件 2.5KB |
| apps/daemon/src/creator/agent/agent-service.ts | apps/daemon/src/paint/agent/agent-service.ts | AI 29.3KB |
| apps/daemon/src/creator/agent/codex-adapter.ts | apps/daemon/src/paint/agent/codex-adapter.ts | Codex 11.8KB |
| apps/daemon/src/creator/agent/context-builder.ts | apps/daemon/src/paint/agent/context-builder.ts | 上下文 5.7KB |
| apps/daemon/src/codx/ | apps/daemon/src/codx/ | Codex 运行时 |
| apps/daemon/src/storage/ | apps/daemon/src/storage/ | SQLite 存储 |

## Web 前端

| OpenCreator | PaintCodex | 说明 |
|---|---|---|
| apps/web/src/main.tsx | apps/web/src/main.tsx | 入口 |
| apps/web/src/runtime/creator-sse.ts | apps/web/src/runtime/paint-sse.ts | SSE 5.2KB |
| apps/web/src/runtime/sse.ts | apps/web/src/runtime/sse.ts | SSE 封装 4.0KB |
| apps/web/src/runtime/client.ts | apps/web/src/runtime/client.ts | 客户端 12.0KB |
| apps/web/src/features/dashboard/ | apps/web/src/features/canvas/ | 主面板 93 文件 |
| apps/web/src/features/conversation/ | apps/web/src/features/ai-chat/ | 对话 13 文件 |
| apps/web/src/features/settings/ | apps/web/src/features/settings/ | 设置 50 文件 |
| apps/web/src/services/ | apps/web/src/services/ | API 59 文件 |
| apps/web/src/host/ | apps/web/src/host/ | Bridge 4 文件 |
| apps/web/src/components/ | apps/web/src/components/ | 组件 |
| apps/web/src/app/ | apps/web/src/app/ | 路由 |

## Desktop

| OpenCreator | PaintCodex |
|---|---|
| apps/desktop/src/main/ | apps/desktop/src/main/ |
| apps/desktop/src/preload/ | apps/desktop/src/preload/ |
| apps/desktop/src/bootstrap/ | apps/desktop/src/bootstrap/ |

## 共享包

| OpenCreator | PaintCodex |
|---|---|
| packages/config/ | packages/config/ |
| packages/protocol/ | packages/protocol/ |

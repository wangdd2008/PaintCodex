# 01: Codex Runtime 接入 app-server 与首批读写工具

**What to build:** 用长驻 `codex app-server` 取代一次性 `codex exec`，把 `canvas_get_context` / `canvas_create_layer` 声明为 dynamic tools，并在同一片里删除 marker 通路（净替代，无回归）。

**Blocked by:** 无

**Status:** ready-for-agent

- [ ] 新增 `apps/daemon/src/paint/agent/runtime/codex-runtime.ts`：spawn `codex app-server`、JSON-RPC 收发、`startThread` / `startTurn` / `interrupt`、事件分发
- [ ] 新增 `runtime/tools.ts`：按 `DynamicToolSpec` 声明 `canvas_get_context`、`canvas_create_layer`；执行器把 create 走 `dispatcher.dispatch(..., { actor: 'agent', expectedRevision })`
- [ ] `runtime/protocol.ts` 由 `codex app-server generate-ts` 生成并提交；加一条 `package.json` 脚本与 CI 比对
- [ ] 启动版本闸门：`codex --version` < 0.164 时 AI 路由不注册，`/health` 给出可操作原因
- [ ] `apps/daemon/src/api/routes.ai.ts` 改用 Runtime；SSE 保留 `delta` / `done` / `error` / `layerCreated`，删除 `AI_CHAT_STEPS` 与 `parseCanvasAction` 调用
- [ ] 删除 `CANVAS_ACTION_MARKER`（protocol）、`apps/daemon/src/paint/agent/canvas-action.ts` 的解析器部分、`prompt.ts` 的 marker 指令；`isSafeSvg` 迁移为工具入参校验器 `runtime/validate-svg.ts`
- [ ] 提示词改为最小摘要（画布 id、尺寸、revision、图层数与图层名）
- [ ] 更新/删除受影响的测试：`ai-chat.test.ts`、`ai-canvas.test.ts`、`ai-chat-instrumentation.test.ts`、`canvas-action.test.ts`、`codex-instrumentation.test.ts`
- [ ] 新增 Runtime 单测：假 app-server 子进程（`process.execPath` + `node -e`，沿用 `codex-instrumentation.test.ts` 的做法）验证 thread/turn/工具调用/中断
- [ ] `pnpm -r typecheck`、`pnpm -r test`、`pnpm -r build` 通过
- [ ] 手工验收：真实 codex 下「画一个红色圆」产出 AI 图层，且 AI 在回复里能引用该图层 id

# 01: Codex Runtime 接入 app-server 与首批读写工具

**What to build:** 用长驻 `codex app-server` 取代一次性 `codex exec`，把 `canvas_get_context` / `canvas_create_layer` 声明为 dynamic tools，并在同一片里删除 marker 通路（净替代，无回归）。

**Blocked by:** 无

**Status:** done

- [x] 新增 `apps/daemon/src/paint/agent/runtime/codex-runtime.ts`：spawn `codex app-server`、JSON-RPC 收发、`startTurn` / `interrupt`、事件分发
- [x] 新增 `runtime/tools.ts`：按 `DynamicToolSpec` 声明 `canvas_get_context`、`canvas_create_layer`；执行器把 create 走 `dispatcher.dispatch(..., { actor: 'agent', expectedRevision })`
- [ ] `runtime/protocol.ts` 由 `codex app-server generate-ts` 生成并提交；加一条 `package.json` 脚本与 CI 比对（本片以窄子集替代，见 Comments 偏差）
- [x] 启动版本闸门：`codex --version` < 0.164 时 AI 路由不注册，`/health` 给出可操作原因
- [x] `apps/daemon/src/api/routes.ai.ts` 改用 Runtime；SSE 保留 `delta` / `done` / `error` / `layerCreated`，删除 `AI_CHAT_STEPS` 与 `parseCanvasAction` 调用
- [x] 删除 `CANVAS_ACTION_MARKER`（protocol）、`canvas-action.ts` 解析器、`prompt.ts` 的 marker 指令；`isSafeSvg` 迁移为工具入参校验器 `runtime/validate-svg.ts`
- [x] 提示词改为最小摘要（画布 id、尺寸、revision、图层数与图层名）
- [x] 更新/删除受影响的测试：`ai-chat.test.ts`、`ai-canvas.test.ts`、`ai-chat-instrumentation.test.ts`、`canvas-action.test.ts`、`codex-instrumentation.test.ts`
- [x] 新增 Runtime 单测：假 app-server 子进程（`process.execPath` + `node -e`）验证 initialize / thread / turn / 工具调用 / 中断 / 崩溃 / 坏行
- [x] `pnpm -r typecheck`、`pnpm --filter @paintcodex/daemon test`、`pnpm --filter @paintcodex/web test` 通过；`pnpm -r build` 的 web 部分受 Windows esbuild 临时文件权限影响（见 Comments）
- [x] 手工验收：真实 codex-cli 0.164.0 下「画一个红色圆」产出 AI 图层；模型回复引用图层名，图层 id 由工具结果返回

## Comments

- 2026-10-27 — 实现完成：`ab6bec3 feat(daemon): drive canvas through codex app-server dynamic tools`。
  - 验证：`pnpm -r typecheck` 通过；`pnpm --filter @paintcodex/daemon test` 149 通过；`pnpm --filter @paintcodex/web test` 203 通过；`pnpm -r build` 中 daemon 构建通过，web 构建因 Windows esbuild 临时文件 `Access is denied` 失败（环境问题，与改动无关，web typecheck 与测试均通过）。
  - 真实 codex-cli 0.164.0 冒烟：runtime 直连（非 HTTP UI），一次 turn 内 2 次工具调用（读画布 → 建图层），产出 `ai-generated` 图层「红色圆」，`metadata.createdBy=agent`；模型回复引用了该图层名，图层 id 在工具结果中返回。
  - 偏差：`runtime/protocol.ts` 是依据 `generate-json-schema` 输出写就的窄子集，未提交 `generate-ts` 全量绑定与 CI 漂移比对（仓库当前没有 CI 配置，CLI 会生成数百个文件）；建议后续补 `pnpm --filter @paintcodex/daemon codex:generate`。
  - 偏差：版本闸门放在 `main.ts` 启动路径，`buildServer({ codexVersion })` 可注入；`buildServer()` 自身不再 spawn `codex --version`，避免无关测试拉起 CLI。
  - 偏差：`StreamPayload.step` 暂留（daemon 不再发送），由票 02 的工具事件帧取代；`apps/web/src/features/ai-chat/AiChatPanel.tsx` 只删了 marker 剥离。
  - 偏差：进程崩溃后未做「自动重启一次」的显式计数；下一次 turn 会重新 spawn 并清空内存 thread 映射。
  - 说明：删除 `codex-runner.ts` 与 `codex-instrumentation.test.ts`（净替代）；`CANVAS_ACTION_MARKER` / `parseCanvasAction` 已全仓清除，`isSafeSvg` 迁至 `runtime/validate-svg.ts`。
  - 合并提示：`item/tool/call` 必须始终回复（超时也回 `success:false`），否则 turn 永远不收尾；服务端请求 id 与客户端请求 id 是两套编号。
- 2026-10-28 — 并行回归修复：`d453a2f fix(daemon): reject pending codex requests deterministically on process death`；随后合入 `feat/codex-native-tools`（merge `d05600b`，含票 02、05 与文档）。
  - 修复：app-server 的 `exit`/`close` 现在幂等并立即拒绝全部 pending 请求与进行中的 turn；请求超时若进程已死则改报退出码错误；首个请求在 `spawn` 事件后才开始计时，避免把进程启动时间算进请求超时。
  - 测试：进程崩溃用例改为通过 `spawn` 测试接缝注入假 `ChildProcess`，确定性驱动 `exit`/`close`，不再与真实子进程启动竞速；daemon 包增加 `vitest.config.ts`（`testTimeout`/`hookTimeout` 30s）覆盖真实子进程用例。
  - 稳定性：合并前 `pnpm -r test` 连续两次全绿（daemon 154 / web 203）；合并票 02/05 后 daemon 169 / web 205，连跑两次全绿（daemon 多 1 个用例，是把崩溃用例拆成「pending 请求」与「in-flight turn」两条）。
  - 注：上一条「`StreamPayload.step` 暂留」的偏差已由票 02 的工具事件帧取代。

# 04: 渲染预览工具与每画布 thread 记忆

**What to build:** 让 AI 能主动索取渲染结果（图像作为工具结果），并把 thread 落到画布上，使连续消息共享上下文。

**Blocked by:** 02

**Status:** done

- [x] `canvas_render_preview`：声明工具；执行请求前端渲染当前画布 PNG，回报 `contentItems: [{ type:'inputImage', imageUrl }]`；超时降级为 `{ ok:false, code:'render_unavailable' }`
- [x] 前端配合：新增渲染请求通道（SSE `renderRequest` 帧 + `POST /paint/ai/render-result`，或复用 confirm 通道），限制单图大小
- [x] thread 落库：`canvases` 增加 `codexThreadId`（沿用 `database.ts` 的 `PRAGMA table_info` + `ALTER TABLE` 幂等迁移）
- [x] daemon 重启后 `resumeThread`；画布删除时 `thread/delete`，失败只记日志
- [x] 失败恢复：thread 失效（404/已归档）时自动 `startThread` 并在气泡里提示「会话已重置」
- [x] 提示词与工具说明保持不含渲染细节（模型自行决定何时预览）
- [x] 测试：预览工具成功 / 超时；thread 建、恢复、失效重建；删除画布清理
- [x] `pnpm -r typecheck`、`pnpm -r test`、`pnpm -r build` 通过（build 的 web 段仍是 esbuild 临时文件权限环境问题，见 Comments）
- [x] 手工验收：User Story 5（「再往右一点」能指代前一轮的图层）；AI 主动预览并纠正出界图形

## Comments

- 2026-10-28 — 实现完成：`31eb5c2 feat(daemon,web): add canvas preview tool and per-canvas thread memory`。
  - 验证：`pnpm -r typecheck` 通过；`pnpm --filter @paintcodex/daemon test` 197 通过（24 文件）；`pnpm --filter @paintcodex/web test` 208 通过（29 文件）；`pnpm -r build` 中 daemon 通过，web 仍因 Windows esbuild 临时文件 `Access is denied` 失败（环境问题，与改动无关，票 01/02 已记录同一现象）。
  - 真实 codex-cli 0.164.0 冒烟（临时脚本，未入库）：第一轮「在画布左侧画一个红色圆形」→ 模型读画布、建图层、并**主动**调用了 `canvas_render_preview`（无浏览器接入，收到 `render_unavailable` 后继续完成）；`canvases.codexThreadId` 写入 `01a17e4a-…`。关闭 app（等价 daemon 重启）后重新 `buildServer`，第二轮「我刚才让你画了什么？只回答颜色和形状」→ 回复「红色圆形。」，`codex-runtime` 日志出现 `thread_resume` 而不是 `thread_start`，User Story 5 得到真实验证。AI 主动预览的失败降级也在同一轮 SSE 里看到（`tool` 帧 failed + `render_unavailable`，turn 正常 `done`）。
  - 偏差：仓库当前**没有删除画布的通路**（无 REST/前端入口），因此「画布删除清理 thread」实现为 `CodexRuntime.deleteThread(canvasId)`：调用 `thread/delete`、清内存映射与库中 id，失败只 `warn` 不抛；`codex-thread.test.ts` 覆盖成功与失败两种。等画布删除落地时在删除处调用这一个方法即可。
  - 偏差：可恢复的 thread 必须非 ephemeral，所以配置了 `CodexThreadStore` 时 `thread/start` 传 `ephemeral:false`；没有 store 的测试替身仍为 ephemeral（既有行为不变）。`thread/resume` 只传 `threadId/cwd/sandbox/approvalPolicy`——0.164.0 的 `ThreadResumeParams` 没有 `dynamicTools`（工具在首次建 thread 时声明）。
  - 偏差：`StreamPayload` 新增两个**可选**字段 `renderRequest: { id, canvasId }` 与 `notice: string`。没有沿用 `error` 表达「会话已重置」，因为前端把 `error` 当终止帧（会标「未完成」并停住回复）；`notice` 是同一气泡里的一行提示，turn 继续。既有 delta/tool/done/error 语义未改。
  - 预览通道设计：`render-preview.ts` 用 `randomUUID` 生成一次性请求 id，请求只能被一个结果满足；pending 在 settle 时立刻移除，迟到/重放的 id 只会得到 409（无法满足新请求）。10s 硬超时、单图 8 MiB data URL 上限；SSE 断开与 turn 中断都通过 abort signal/`close()` 立即把挂起请求结算为 `render_unavailable`。`POST /paint/ai/render-result` 返回 204/400/409/413。Web 复用 `exportActiveCanvasPng()`，不重复实现导出；没有活动画布时不回传，由 daemon 超时兜底。
  - 偏差：新增 `apps/daemon/vitest.config.ts`（`testTimeout`/`hookTimeout` 30s）。runtime 测试每个用例都 spawn 一个真实子进程，`pnpm -r test` 并行时 5s 默认超时被环境负载击穿（本分支基线跑全量时就已有 11 个同类抖动）；同时把既有「app-server 崩溃」用例的 `requestTimeoutMs` 从 2s 放宽到 10s。
  - 未改动：`canvas_delete_layer` 语义、确认通道（03）、export、删除门禁、`docs/architecture-design.md` 与 ADR。
  - 合并提示（给 03）：本票在 `routes.ai.ts`、`codex-runtime.ts` 上与确认通道会有冲突——渲染结果路由是独立注册函数 `registerRenderResultRoute`，`CodexRuntime` 接口新增了 `deleteThread`（测试替身需补），`CodexTurnInput` 新增 `requestRender` / `onNotice`；`fake-runtime.ts` 已同步。


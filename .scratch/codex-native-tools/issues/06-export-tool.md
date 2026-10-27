# 06: 导出工具与确认

**What to build:** 让 AI 能请求「导出当前画布为 PNG」，执行前经用户确认，导出动作仍由浏览器完成（ADR-0005：导出是客户端行为）。

**Blocked by:** 03（确认通道）、04（客户端请求通道）

**Status:** done

背景：spec 的工具表列了 `canvas_export_png`，但它需要两件当时还不存在的东西——确认通道（票 03）与浏览器侧的请求/应答通道（票 04 为预览建的）。因此从票 03 中移出，单独落地。

- [x] 新增工具 `canvas_export_png`（`{ canvasId }`），执行前调用票 03 的确认helper（`requestConfirmation(canvasId, { title, detail }, trace)`）；拒绝返回 `{ ok:false, code:'user_declined' }`
- [x] 导出请求经票 04 的客户端通道下发；浏览器复用既有 PNG 导出实现（`apps/web/src/features/canvas/`），不得重复实现渲染逻辑
- [x] 成功返回 `{ ok:true, filename, bytes }`（只回报大小与文件名，不回传图片本体，避免把整张图塞进模型上下文）
- [x] 超时/通道不可用返回 `{ ok:false, code:'export_unavailable' }`；同一画布同时只允许一个导出请求
- [x] 确认文案明确「将下载一张 PNG」，与删除的确认文案区分
- [x] 测试：确认通过/拒绝/超时、通道失败、并发第二个请求被拒、Web 侧真的调用了导出
- [x] `pnpm -r typecheck`、`pnpm -r test` 通过
- [ ] 手工验收：说「把这张图导出来」→ 出现确认 → 确认后浏览器下载 `<画布名>.png`（未在本环境执行，见 Comments）

## Comments

- 2026-10-28 — 实现完成：`4e75bfd feat(daemon,web): add confirmed canvas export tool`。
  - 验证：`pnpm -r typecheck` 通过；`pnpm -r test` 连续两轮全绿（daemon 28 文件 246 用例，web 31 文件 216 用例）。新增用例覆盖：通道投递/超时/并发拒绝/断开/abort、工具确认通过/拒绝/超时/无确认通道/无浏览器/繁忙、runtime 结果不含图片且导出期间工具超时暂停、HTTP 帧与结果路由、Web 真的调用 `exportActiveCanvasPng()` + `downloadPng()` 并回传 filename/bytes。
  - 设计：新增 `export-png.ts`，形状照 `render-preview.ts`（一次性 id、10s 硬超时、settle 即出队、`close()`/abort 立即降级）。请求走 SSE `exportRequest` 帧，回执走独立的 `POST /paint/ai/export-result`；不复用 render-result，因为导出不上传图片，只回 filename/bytes，语义不同。runtime 侧复用既有 `suspendTimeout`/`resumeTimeout`，没有第二套挂起机制。
  - 偏差：`StreamPayload.confirm` 新增可选 `approveLabel`；导出的 CTA 是「下载 PNG」，删除确认不传该字段，渲染仍为「删除」（既有行为不变）。
  - 偏差：并发第二个导出返回新失败码 `export_busy`（票面只要求「明确 code」）。
  - 偏差：浏览器拿不到 `exportActiveCanvasPng()` 结果时立即回传 `{ error }`，工具快速降级为 `export_unavailable`；浏览器完全不答仍由 10s 超时兜底。
  - 未执行：真实 codex + 浏览器的手工验收（本环境无交互浏览器）；其余 DoD 已满足。

- 2026-10-28 — 合并 `feat/codex-native-tools`（merge `4c5c3be`）：无冲突（上游仅新增票 07 文档与 `apps/web/vite.config.ts` 的 jsdom 测试预算）。合并后 `pnpm -r typecheck` 通过，`pnpm -r test` 连续两轮全绿（daemon 28 文件 246 用例，web 31 文件 216 用例）。

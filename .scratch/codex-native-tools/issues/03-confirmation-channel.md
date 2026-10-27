# 03: 不可逆动作的确认通道

**What to build:** 删除执行前阻塞询问用户，答复经新端点回传；用户拒绝、超时或中断时返回可读错误给模型。

**Blocked by:** 02

**Status:** done

- [x] Runtime：确认通道登记挂起项（`requestId` → resolve），支持 60s 超时、客户端断开、turn 中断与 daemon 关闭清理
- [x] `StreamPayload` 增加 `confirm` 帧：`{ id, title, detail }`
- [x] 新增 `POST /paint/ai/confirm`：`{ requestId, approved, canvasId? }`；未知 requestId 返回 404，重复答复幂等，画布不匹配同样 404
- [x] `canvas_delete_layer` 执行前走确认；拒绝/超时/断开返回 `{ ok:false, code:'user_declined', message }`
- [x] 超时策略：60s 未答复视为拒绝，向模型说明「用户未答复」；挂起期间暂停工具超时计时，避免 30s `tool_timeout` 抢先
- [x] Web：确认条渲染在气泡内，两条按钮「删除 / 取消」；超时后置灰并显示「确认已超时」，提交期间禁用防连点
- [x] 边界：SSE 断开 / turn 中断 / runtime 关闭时清理挂起项；同一 thread 内确认仍串行
- [x] 测试：确认通过 / 拒绝 / 超时 / 未知 requestId / 断开清理 / turn 中断；Web 确认条交互、超时与防连点
- [x] `pnpm -r typecheck`、`pnpm --filter @paintcodex/daemon test`、`pnpm --filter @paintcodex/web test` 通过
- [x] 验收：User Story 2 由「确认帧 → 端点 → 工具恢复 / 拒绝」的测试覆盖（未跑真实 codex 手工冒烟）

## Comments

- 2026-10-28 — 实现完成：`a59d00f feat(daemon): add confirmation channel for irreversible tools`。
  - 验证：`pnpm -r typecheck` 通过；`pnpm --filter @paintcodex/daemon test` 194 通过；`pnpm --filter @paintcodex/web test` 210 通过。`pnpm -r build` 的 daemon/protocol 段通过，web 段仍因 Windows esbuild 临时文件 `Access is denied` 失败（与票 01/02 记录的同一环境问题；web typecheck 与测试均通过）。
  - 通道 API（后续工具一次调用即可）：`createConfirmationChannel({ timeoutMs?, settledRetentionMs?, logger? })` 返回 `requestConfirmation(canvasId, { title, detail }, { onConfirm, trace, signal })`、`answer(requestId, approved, canvasId?)`、`cancelCanvas(canvasId, reason)`、`cancelAll(reason)`、`pendingCount()`、`close()`；工具侧只需 `await context.requestConfirmation?.({ title, detail })`，拒绝原因（`declined|timeout|disconnected|interrupted`）由 `tools.ts` 的 `requireConfirmation()` 统一转成 `{ ok:false, code:'user_declined', message }`。
  - 端点：`POST /paint/ai/confirm`，body `{ requestId, approved, canvasId? }`；响应 `{ ok:true, status, duplicate }`，`status ∈ approved|declined|timeout|disconnected|interrupted`；未知 id 404，重复答复 200 且保留首次结果。
  - 超时：通道默认 60s；确认挂起期间暂停 runtime 的工具超时计时（`toolTimeoutMs` 仍管工具自身计算），因此不会出现 30s 先返回 `tool_timeout` 的情况。
  - 偏差：答复 body 增加可选 `canvasId`（spec 只写 `{ requestId, approved }`）。Web 每次提交都带发起请求时的画布 id，daemon 对不匹配的答复返回 404 且不解析挂起项；requestId 本身是随机 UUID，未携带 `canvasId` 的答复仍按 id 作答。
  - 偏差：`canvas_delete_layer` 先校验 canvas/layer 再询问，避免让用户为一个必然失败的操作点确认。
  - 偏差：确认条按钮固定为「删除 / 取消」，因为本票只有删除需要确认；06 的导出确认需要通用按钮文案时再扩展。
  - 任务重划：`canvas_export_png` 在本分支尚不存在，且它需要的「前端生成 PNG 并回传结果」通道与 04 的预览请求共用；导出工具及其确认移到新票 `06-export-tool.md`（`feat/codex-native-tools` 上的 `d63593a docs(spec): split export tool into ticket 06` 已建票），本票不实现导出。
  - 手工验收：未跑真实 codex CLI 冒烟；User Story 2 的「删除前被询问」由 daemon 集成测试（fake app-server + 挂起工具 → 确认帧 → 确认端点 → 工具恢复）与 Web 交互测试覆盖。
  - 合并 `feat/codex-native-tools`（`a9ba6f6`，带入票 06 与 spec 切片第 5 行）后复跑：`pnpm -r typecheck` 通过，daemon 194 通过，web 210 通过。
  - 后续 `ff7ab80 test(daemon): widen runtime test budget under parallel load`：`codex-runtime.test.ts` 每个用例都会 spawn 一个真实 Node 子进程；全仓并行跑时出现过 5s 默认单测预算被进程启动耗时打满的抖动，故该文件单测预算放宽到 30s（与 runtime 的 15s 请求超时对齐），断言未变。

# 03: 不可逆动作的确认通道

**What to build:** 用 `ToolRequestUserInput` 让删除与导出在执行前阻塞询问用户，答复经新端点回传；用户拒绝时返回可读错误给模型。

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] Runtime：处理 `ToolRequestUserInput` 请求，登记挂起项（`requestId` → resolve），支持超时与客户端断开
- [ ] `StreamPayload` 增加 `confirm` 帧：`{ id, title, detail }`
- [ ] 新增 `POST /paint/ai/confirm`：`{ requestId, approved }`；未知 requestId 返回 404，重复答复幂等
- [ ] `canvas_delete_layer` / `canvas_export_png` 执行前走确认；拒绝返回 `{ ok:false, code:'user_declined' }`
- [ ] 超时策略：60s 未答复视为拒绝，向模型说明「用户未答复」
- [ ] Web：确认条渲染在气泡内，两条按钮「删除 / 取消」；超时后置灰并显示已超时
- [ ] 边界：取消（SSE 断开）时清理挂起项；同一 turn 内多条确认串行
- [ ] 测试：确认通过 / 拒绝 / 超时 / 未知 requestId / 断开清理；Web 确认条交互
- [ ] `pnpm -r typecheck`、`pnpm -r test`、`pnpm -r build` 通过
- [ ] 手工验收：User Story 2（删除前被询问）、导出前被询问

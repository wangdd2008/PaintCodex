# 06: 导出工具与确认

**What to build:** 让 AI 能请求「导出当前画布为 PNG」，执行前经用户确认，导出动作仍由浏览器完成（ADR-0005：导出是客户端行为）。

**Blocked by:** 03（确认通道）、04（客户端请求通道）

**Status:** ready-for-agent

背景：spec 的工具表列了 `canvas_export_png`，但它需要两件当时还不存在的东西——确认通道（票 03）与浏览器侧的请求/应答通道（票 04 为预览建的）。因此从票 03 中移出，单独落地。

- [ ] 新增工具 `canvas_export_png`（`{ canvasId }`），执行前调用票 03 的确认helper（`requestConfirmation(canvasId, { title, detail }, trace)`）；拒绝返回 `{ ok:false, code:'user_declined' }`
- [ ] 导出请求经票 04 的客户端通道下发；浏览器复用既有 PNG 导出实现（`apps/web/src/features/canvas/`），不得重复实现渲染逻辑
- [ ] 成功返回 `{ ok:true, filename, bytes }`（只回报大小与文件名，不回传图片本体，避免把整张图塞进模型上下文）
- [ ] 超时/通道不可用返回 `{ ok:false, code:'export_unavailable' }`；同一画布同时只允许一个导出请求
- [ ] 确认文案明确「将下载一张 PNG」，与删除的确认文案区分
- [ ] 测试：确认通过/拒绝/超时、通道失败、并发第二个请求被拒、Web 侧真的调用了导出
- [ ] `pnpm -r typecheck`、`pnpm -r test` 通过
- [ ] 手工验收：说「把这张图导出来」→ 出现确认 → 确认后浏览器下载 `<画布名>.png`

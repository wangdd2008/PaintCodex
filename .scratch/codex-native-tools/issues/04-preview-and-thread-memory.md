# 04: 渲染预览工具与每画布 thread 记忆

**What to build:** 让 AI 能主动索取渲染结果（图像作为工具结果），并把 thread 落到画布上，使连续消息共享上下文。

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] `canvas_render_preview`：声明工具；执行请求前端渲染当前画布 PNG，回报 `contentItems: [{ type:'inputImage', imageUrl }]`；超时降级为 `{ ok:false, code:'render_unavailable' }`
- [ ] 前端配合：新增渲染请求通道（SSE `renderRequest` 帧 + `POST /paint/ai/render-result`，或复用 confirm 通道），限制单图大小
- [ ] thread 落库：`canvases` 增加 `codexThreadId`（沿用 `database.ts` 的 `PRAGMA table_info` + `ALTER TABLE` 幂等迁移）
- [ ] daemon 重启后 `resumeThread`；画布删除时 `thread/delete`，失败只记日志
- [ ] 失败恢复：thread 失效（404/已归档）时自动 `startThread` 并在气泡里提示「会话已重置」
- [ ] 提示词与工具说明保持不含渲染细节（模型自行决定何时预览）
- [ ] 测试：预览工具成功 / 超时；thread 建、恢复、失效重建；删除画布清理
- [ ] `pnpm -r typecheck`、`pnpm -r test`、`pnpm -r build` 通过
- [ ] 手工验收：User Story 5（「再往右一点」能指代前一轮的图层）；AI 主动预览并纠正出界图形

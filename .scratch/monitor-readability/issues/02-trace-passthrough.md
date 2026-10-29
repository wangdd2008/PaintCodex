# 02: 追踪补全 canvas-action 与 sse

**What to build:** 把 trace context 传进画布写入与 SSE 推送，让一次 AI 对话的追踪包含「画布真的被改了」和「结果推给了浏览器」。

**Blocked by:** 01

**Status:** done

**Covers:** 监控 §3

**Size:** M

## Acceptance Criteria

- [x] `CommandDispatcher` 与 `PaintService` 的写方法接受可选 `trace?: TraceContext`，默认 `undefined`。
- [x] AI 工具执行路径传入 `turn span`；REST 写路径传入 HTTP span。
- [x] `canvas-action` 记录带 `traceId` 且 `parentId` 指向发起它的 span。
- [x] `ObservabilityEvents.publish`（及 `sse_publish` 记录）带上触发它的 trace，附 `parentId`。
- [x] 一次工具调用的追踪里能同时查到 `tool_call`、`layer_update`、`sse_publish` 三条记录。
- [x] REST 直接写入（非 AI）的 `canvas-action` 归属到那次 HTTP 请求的追踪。
- [x] 没有 trace 的调用方（如后台任务、测试）行为不变，记录仍是 NULL trace，列表里进「未归组」。
- [x] daemon 集成测试断言上述三条记录共享同一 `traceId`。

## Notes

- 只改服务层的参数透传，不改协议、不改前端。
- `sse_publish` 由画布写入触发时，必须使用**同一个** trace；由其他来源触发时保持 NULL。


## Comments

- 2026-10-29 · 实现完成：`afb9d06`，合入 integration 分支 `feat/canvas-library-workspace-monitor`（merge `893730a`）；经 code-review 双轴复查与统一修复（`4475df8`/`bdcc10a`）后验收全部满足，关闭。

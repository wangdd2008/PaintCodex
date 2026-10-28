# 01: 日志方向模型 source/target

**What to build:** `agent_logs` 增加方向的来源与目标，埋点按映射表填写，旧数据只回填能证明的部分。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

**Covers:** 监控 §1、§2

**Size:** M

## Acceptance Criteria

- [ ] `LogComponent = 'browser' | 'daemon' | 'codex' | 'model' | 'sqlite'` 定义在 `packages/protocol`，与后端校验共用。
- [ ] `agent_logs` 增加可空列 `source`、`target`；`NewAgentLogRecord` / `AgentLog` / `LoggerLogInput` / `SpanStart` 增加可选字段。
- [ ] 按 spec 的映射表填写：`http` 起始 `browser→daemon`、结束 `daemon→browser`；`sse_subscribe` `browser→daemon`；`sse_publish` `daemon→browser`；`sse_disconnect` `browser→daemon`；`turn_start` / `thread_start` / `thread_resume` `daemon→codex`；`turn_complete` `codex→daemon`；`tool_call`（canvas-tool）`codex→daemon`；`canvas-action` 的 create/update/delete/undo/redo/rename `daemon→sqlite`。
- [ ] 内部事件（`system`、进程错误等）保持 NULL；语义是「内部」，不是「未知」。
- [ ] 迁移只执行两条回填：`http → browser/daemon`、`sse → daemon/browser`；其余保持 NULL。
- [ ] 每条映射都有测试（真实 payload 下断言 source/target）；迁移测试断言回填范围。
- [ ] 现有日志条目的形状不破坏：旧版本的客户端读取新记录时忽略两个新字段也能工作。

## Notes

- 不要按 `codex-runtime` 分类统一猜方向——该类里请求与响应并存。
- `model` 组件没有任何直接日志；它只存在于术语与拓扑里。

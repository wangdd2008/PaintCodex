# Codex 集成 Resources

版本基线：`codex-cli 0.164.0`（2026-10-28 本机实测）。上游协议带 `[experimental]` 标记，所有外部资料都要按本机版本复核。

## Knowledge

- [Codex app-server README（官方）](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)
  app-server 的一手说明：启动方式、JSON-RPC 生命周期、thread/turn、客户端请求与通知。**首选主源**；字段以本机 `generate-json-schema` 为准。
- [Codex 仓库 app-server 源码](https://github.com/openai/codex/tree/main/codex-rs/app-server)
  协议行为的最终事实来源。读 README 有歧义时，看这里的 `src/` 与测试。
- [PaintCodex ADR-0009：AI 通过 Codex dynamic tools 驱动画布](docs/adr/0009-ai-drives-canvas-through-codex-dynamic-tools.md)
  本项目的决策记录：为什么放弃一次性 `exec` + marker 文本协议，选择长驻 app-server 与进程内工具。
- [PaintCodex ADR-0002：Codex CLI via Local Child Process](docs/adr/0002-codex-cli-local-process.md)
  为什么走本地子进程而不是远程 API；ADR-0009 修订了交互方式，但本地优先的结论未变。
- [PaintCodex spec：Codex 原生工具](.scratch/codex-native-tools/spec.md)
  问题、工具集、失败码、SSE 帧、验收记录。读它比读代码更快建立全貌。
- [Lab：最小 app-server 会话](labs/02-minimal-session/session.mjs)
  可运行的最小骨架：进程、JSONL、thread/turn、一个工具、结果回传。用它来对照课程 02，或直接改成自己领域的第一个工具。
- [JSON-RPC 2.0 Specification](https://www.jsonrpc.org/specification)
  请求 / 响应 / 通知的通用语义。注意：app-server 用「一行一个 JSON 消息」的传输，且本仓库的消息不带 `jsonrpc` 字段。
- [MDN: Using server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)
  浏览器侧 `EventSource` / SSE 帧格式与断线语义；本项目用 `fetch` 流式读取，概念相同。
- [OpenAI: Codex as a platform](https://developers.openai.com/blog/codex-as-a-platform)
  官方对「把 Codex 当引擎」的定位与 SDK / app-server 的分层说明。仅作背景，细节仍以仓库为准。

## Wisdom (Communities)

- [openai/codex Issues](https://github.com/openai/codex/issues)
  搜 `app-server`、`dynamicTools`、`item/tool/call`。协议变动、字段缺失、平台差异的第一现场；提问时附版本号与最小复现 JSONL。
- [openai/codex Discussions](https://github.com/openai/codex/discussions)
  适合问「这种集成方式是否合理」而不是报 bug。信号弱于 Issues，但维护者会出现。
- 本仓库的 ADR 与 `.scratch/*/issues/`
  不是在线社区，但是同一套问题的「实践者笔记」：每条决策都带被否掉的替代方案，适合对照自己的设计。

## Gaps

- 没有稳定的 dynamic tools 官方教程；README 是唯一系统说明，且随版本变。
- 没有官方 TypeScript app-server 客户端；`@openai/codex-sdk` 走的是 `codex exec` 路线，不覆盖进程内工具回调。
- 中文资料几乎为零；本项目的中文 ADR/spec 是目前最好的中文样本。

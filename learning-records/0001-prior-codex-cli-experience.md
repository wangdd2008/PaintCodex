# 起点：Codex CLI 使用者，未接触 app-server

学习者用过 Codex CLI 的 `exec` 与交互模式，理解「提示词进、文本出」，但没有写过 `codex app-server` 或 JSON-RPC 集成；目标是 Web 产品里的 AI 助手。这意味着后续课程可以跳过 LLM / tool calling 的基础概念，直接从「长驻进程 + thread/turn + 进程内工具回调」讲起，并用真实协议消息而不是伪代码来建立直觉。

## Evidence

用户在课程开始前的自述：用过 Codex CLI（exec/交互），没写过 app-server 集成；目标形态是「Web 应用的 AI 助手（前端画布/表单/数据操作）」。

## Implications

- 第一课应从 `exec` 的心智模型切换开始，重点讲清「为什么文本协议不够」。
- 练习应围绕协议消息与适配层代码，而不是提示词写法。
- 迁移目标已明确为 Web 应用，后续 capstone 应要求浏览器 ⇄ daemon ⇄ app-server 的完整闭环。

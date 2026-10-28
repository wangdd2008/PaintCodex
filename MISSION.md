# Mission: 把 Codex 变成自己 Web 产品的 AI 引擎

## Why

我想在自己的 Web 产品里做一个「能真正操作业务状态」的 AI 助手——改画布、填表单、动数据——而不是只会回一段文本。PaintCodex 已经用 `codex app-server` + dynamic tools 跑通了这件事，我要把它拆开学会，再迁移到下一个项目。

## Success looks like

- 能画出并解释从浏览器到模型的完整链路，指出五道接缝各自负责什么、坏了会怎样。
- 能在新项目里独立跑通最小闭环：拉起 `app-server`、建 thread、声明一个工具、处理工具调用、流式回传、结束 turn。
- 能为自己的领域设计一套工具：读上下文、写操作、危险操作确认、失败对模型可读、并发写不互相覆盖。
- 遇到 codex 升级、协议字段漂移、进程崩溃、turn 卡死时，知道先看哪一层、用什么证据定位。

## Constraints

- 已有 Codex CLI（`exec` / 交互）使用经验；没有写过 app-server / JSON-RPC 集成。
- 目标形态是 Web 应用：浏览器前端 + 本地或远程 daemon。
- 用中文教学；单次 10–15 分钟，先图后码，练习要能立刻验证。
- 以 PaintCodex 的真实代码为样本，不另造玩具仓库。

## Out of scope

- 模型训练、微调、提示词工程调优。
- 用 MCP server 实现同一套工具（会作为对照提到，不作为主线）。
- Codex 的 Rust 内部实现与完整协议面。
- 多 agent 编排、沙箱逃逸、计费与配额。

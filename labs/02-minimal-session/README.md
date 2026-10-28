# Lab 02：最小 app-server 会话

配套课程：[`lessons/0002-run-your-first-session.html`](../../lessons/0002-run-your-first-session.html)。

这个脚本只保留协议骨架：

```text
spawn codex app-server
  → initialize
  → thread/start（声明 notes_add）
  → turn/start
      → item/tool/call → 本地 runTool → 回 contentItems
  → turn/completed
```

## 运行

```bash
node labs/02-minimal-session/session.mjs
```

要求：Node.js 22+、`codex` >= 0.164.0、已登录。

Windows 会自动经 `cmd.exe` 调用 `codex.cmd`；也可以用 `CODEX_BIN` 指定路径。

## 你会看到

- 每一行发出的请求、收到的响应与通知；
- 一次 `item/tool/call`，id 可能是 `0`（服务端自己的命名空间）；
- 本地执行结果，以及回给模型的 `{ success, contentItems }`；
- 最后一句助手回复与内存里的笔记数组。

如果退出码是 `2`，说明这一轮没有触发工具调用。重跑一次；仍然不行就检查登录与版本。

## 改它

1. 给 `NOTES_ADD_TOOL` 加一个 `mood` 字段（`calm` / `urgent`），设为必填。
2. 在 `runTool` 里校验并保存它。
3. 改 `PROMPT`，要求模型带 `mood`。
4. 重跑，观察 `arguments` 与 `item/completed` 的 status。

这一步是课程 02 的核心练习：schema 改了，模型才会传；校验严了，模型才会收到 `invalid_arguments` 并重试。

## 注意

- `developerInstructions` 只是提高工具调用概率，不能保证模型一定调用；生产代码不能依赖「它一定会」。
- 工具结果永远是 `{ success, contentItems }`；业务结果放在 `contentItems[0].text` 的 JSON 里。
- 这个 lab 没有确认、超时、重试、持久化；这些在课程 03–05 和 `apps/daemon/src/paint/agent/runtime/` 里。

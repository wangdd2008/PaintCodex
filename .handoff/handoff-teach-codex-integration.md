# Handoff: 用 PaintCodex 教 Codex 集成（课程 01–02 已交付）

> Generated: 2026-10-28 23:27 (Asia/Shanghai)
> Session focus: 以 PaintCodex 为样本，教用户掌握 `codex app-server` + dynamic tools 的集成方式
> Status: 课程 01、02 与配套参考已交付并验证；等待用户做练习 / 回答迁移问题

## 当前状态

- **没有改产品代码**：`apps/`、`packages/`、`docs/` 均未改动；本轮只新增教学材料。
- 教学材料是仓库根目录的未跟踪文件：`MISSION.md`、`NOTES.md`、`RESOURCES.md`、`index.html`、`assets/`、`lessons/`、`reference/`、`labs/`、`learning-records/`。**不要把它们当成产品代码提交**，除非用户明确要求。
- `.agents/` 已由 `.gitignore` 忽略；`.codegraph/`、`.qwen/` 是本机/工具目录，**不要清理或提交**用户内容。
- 课程 01 与 02 都已在默认浏览器打开过；用户是否完成练习、是否答题，**尚未反馈**。
- 用户尚未回答课程 03 需要的两个问题（见「Open items」）。

## 先读这些（状态与上下文）

按顺序读，能避免重复劳动：

1. `MISSION.md` —— 为什么学：把 Codex 变成自己 Web 产品的 AI 引擎；成功标准与边界。
2. `NOTES.md` —— 学习者画像、教学偏好、六课路线、工作备注（含本轮验证记录）。
3. `learning-records/0001-prior-codex-cli-experience.md` —— 用户已用过 Codex CLI 的 `exec`/交互，没写过 app-server；目标是 Web 应用。
4. `RESOURCES.md` —— 主源、社区、缺口。主源是上游 app-server README。
5. `lessons/0002-run-your-first-session.html` —— 最近交付的一课，含真实 transcript。

## 本轮交付物（只给指针，不重复内容）

| 文件 | 作用 |
|---|---|
| `index.html` | 课程首页：六课路线、参考入口、材料用法 |
| `lessons/0001-from-exec-to-app-server.html` | 课程 01：进程/线程/轮次/条目、五道接缝、10 步可交互消息流、4 道题 |
| `lessons/0002-run-your-first-session.html` | 课程 02：跑 lab、三段拆解、4 道题、给 `notes_add` 加 `mood` 的练习 |
| `reference/protocol-cheatsheet.html` | 协议速查卡：生命周期、消息方向、最小 JSONL、失败码、超时、升级清单；可打印 |
| `reference/glossary.html` | 25 条术语，统一 thread/turn/item 等用法 |
| `labs/02-minimal-session/session.mjs` | 约 430 行、零依赖的最小 app-server 会话脚本 |
| `labs/02-minimal-session/README.md` | lab 的运行、预期输出、改法与注意事项 |
| `assets/course.css` | 共享设计系统：纸张色、衬线标题、可打印、移动端 |
| `assets/quiz.js` / `assets/stepper.js` | 可复用交互组件（quiz 即时反馈、stepper 深链） |
| `MISSION.md` / `NOTES.md` / `RESOURCES.md` | 教学目标、教学笔记、资源清单 |

已用 `present` 向用户展示课程 01、02 与速查卡；课程页已 `Start-Process` 打开。

## 必须保留的技术结论（本轮实际验证过的）

- 基线 `codex-cli 0.164.0`（本机，2026-10-28）。协议是 experimental，字段以本机 `codex app-server generate-json-schema --experimental` 为准；本地 schema 在 `.agents/codex-schema/`（gitignored）。
- 传输是**按行分隔的 JSON**；本协议消息不带 `jsonrpc` 字段。三类消息：
  - 有 `method` + `id`：请求（客户端→服务端，或服务端→客户端）；
  - 有 `method` 无 `id`：通知；
  - 只有 `id`：响应。
- 生命周期：`initialize`（`capabilities.experimentalApi:true`）→ `thread/start`（声明 `dynamicTools`）→ `turn/start` → 事件 → `turn/completed`。
- **服务端反向请求 `item/tool/call` 的 id 是独立命名空间**。真实首轮是 `id: 0`；客户端必须原样回传同一个 id，不能重新编号，也不能用 `callId` 代替。
- 工具结果形状：`{ success, contentItems }`；业务结果放在 `contentItems[0].text` 的 JSON 里。失败是 `success:false` + 可读 JSON，不是抛异常。
- `item/completed` 只表示某个条目结束；**只有 `turn/completed` 结算整轮**。
- 要在发 `turn/start` 之前挂好 deferred / 监听，否则可能漏掉立刻到达的 `turn/completed`。
- 生产 `CodexRuntime` 的关键行为（课程 03–05 会展开）：懒启动进程、版本闸门 0.164.0、同线程工具串行队列、工具 30s 超时（人在确认/渲染/导出时暂停计时）、确认 60s、SSE 断开 → `turn/interrupt`、崩溃懒重启。
- 课程 01 的五道接缝与文件：`routes.ai.ts`、`codex-runtime.ts`（编排 + 传输）、`tools.ts`、`command-dispatcher.ts`；详见课程页，不要在 handoff 里复述。

## 验证证据

- `node labs/02-minimal-session/session.mjs` 用真实 CLI 跑了 3 次，退出码 0：
  - 看到 `item/started` → `{"method":"item/tool/call","id":0,...}` → 本地 `notes_add` → `{"id":0,"result":{"success":true,...}}` → `item/completed` → `turn/completed completed`；
  - 助手最后确认「1 条笔记」；`tool call: 1 次`。
  - 最后一次完整日志：`.agents/lab-02-final.log`（本机临时，不要依赖路径）。
- `node --check labs/02-minimal-session/session.mjs` 通过。
- Playwright（Chrome headless）验证：
  - 课程 01：10 步 stepper、前后跳转、`#step-7` 深链、4 题反馈/计分正常；
  - 课程 02：4 题反馈/计分正常；
  - 1440 与 390 宽：`index`、两课、速查卡、术语表均无横向溢出；
  - print media：stepper 展开全部步骤，代码块转为浅色。
- **没有跑 `pnpm -r test` / `build`**：本轮未改产品代码，不需要；下一轮如果改 `apps/` 再跑。

## 用户位置与未决问题

用户的原话是「开始 02 吧」，随后做了 `/handoff`。所以：

- 用户可能刚拿到课程 02，**还没做 `mood` 练习，也没回答迁移问题**。
- 不要假设用户已经掌握；先问「跑通了吗？看到 `item/tool/call` 了吗？」再决定是否写 learning record。
- 课程 03 需要两个输入：
  1. 用户产品里被 AI 操作的第一个对象是什么（画布/表单/记录/工单…）；
  2. 哪个动作不可逆（删除/发送/付款/覆盖发布…）。
- 如果用户没答，**先追问，不要替他们假设**；这决定 03 的工具集例子。

## Open items / 下一轮建议

1. 开场先确认 02 的结果：是否跑通、是否看到 `item/tool/call`（id 0）、是否完成 `mood` 练习。
2. 如果用户完成了练习且能解释「schema 改了模型才传 / 失败作为结果返回」，写 `learning-records/0002-...md`，记录证据与新的教学下限。
3. 根据两个迁移问题做 **课程 03：给模型装手**。建议内容：工具 schema 的边界（required/enum/additionalProperties）、失败码设计、`expectedRevision`、同线程串行队列、只读 vs 写工具、哪些动作先不做确认。以用户的领域对象为例，不要再用 `notes_add`。
4. 课程 03 可以复用 `assets/` 的 quiz/stepper，但不要重复课程 02 的 lab；最好给一个「改 lab 成用户领域工具」的练习，形成真实反馈回路。
5. 课程 04–06 仍是路线图占位：浏览器 SSE/确认、会话与故障、迁移演练。不要提前写，按用户进度推进。
6. 每课交付后：更新 `NOTES.md` 的路线/验证、必要时更新 `index.html` 的课程链接、跑一次链接检查与移动端溢出检查。

## 运行 / 打开

```powershell
# 课程首页
Start-Process (Resolve-Path index.html).Path

# 最近一课
Start-Process (Resolve-Path lessons/0002-run-your-first-session.html).Path

# 实验（需要 codex 已登录）
node labs/02-minimal-session/session.mjs

# 本地协议 schema（升级 codex 后）
codex app-server generate-json-schema --experimental -o .agents/codex-schema
```

## 约束与偏好

- 用中文教学；代码、命令、协议字段保留英文。
- 先图/真实消息流，再进代码；每课 10–20 分钟，结尾要有可自动判定的检索练习。
- 用户不喜欢空泛的「最佳实践」；每个设计判断要给出被否掉的替代方案与代价。
- 课程页是主教材，参考页是实现时查的压缩版；两者互相链接。
- 教学文件在仓库根目录，**不要和 `apps/`/`packages/` 的产品代码混在一起提交**。

## Suggested skills

- **`teach`** —— 首要。下一轮先加载它；它规定了这个工作区的状态文件、课时结构与 ZPD 原则。
- **`agent-browser`** —— 如果新增/修改课程页，用它实际点击 quiz/stepper、检查移动端与截图；本轮即用 Playwright/Chrome 做过。
- **`handoff`** —— 下一次交接时继续用本格式，文件名建议 `handoff-teach-codex-integration-<topic>.md`。
- **`research`** —— 仅当需要复核上游 app-server 协议/新版字段时；优先用本机 `generate-json-schema`，不要凭记忆写字段。

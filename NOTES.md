# 教学笔记

## 学习者画像

- 已用过 Codex CLI 的 `exec` / 交互模式；了解「给模型一段话、拿回文本」。
- 没写过 `codex app-server` / JSON-RPC 集成；需要从「进程、线程、轮次、条目」这层建立心智模型。
- 目标：Web 产品里的 AI 助手，AI 通过工具操作画布 / 表单 / 数据。
- 详见 `learning-records/0001-prior-codex-cli-experience.md`。

## 教学偏好

- 中文讲解；代码、命令、协议字段保留英文。
- 先一张图 / 一条真实消息流，再进代码；不要先铺概念。
- 每课 10–15 分钟，结尾必须有一次可自动判定的检索练习。
- 练习最好能在自己的机器上跑，用真实输出反馈，而不是只看讲解。
- 不喜欢空泛的「最佳实践」；每个设计判断要给出被否掉的替代方案和代价。

## 课程路线（暂定）

1. **0001 从 exec 到 app-server：一条消息的旅程** —— 四个名词、五道接缝、消息方向。
2. **0002 亲手跑通一次会话** —— 用 Node 脚本驱动 `app-server`，声明一个工具并回答它。
3. **0003 给模型装手** —— 工具 schema、失败语义、`expectedRevision`、串行队列。
4. **0004 把 turn 接到浏览器** —— SSE 帧、确认通道、浏览器往返（render/export）。
5. **0005 会话与故障** —— thread 持久化、懒重启、版本闸门、协议漂移。
6. **0006 迁移演练** —— 为自己的 Web 应用设计工具集，并写最小垂直切片。

## 工作备注

- 入口页：`index.html`；课程 01 `lessons/0001-from-exec-to-app-server.html`；课程 02 `lessons/0002-run-your-first-session.html`。
- 课程 02 的实验：`labs/02-minimal-session/session.mjs`。已用真实 `codex-cli 0.164.0` 跑通两次：`item/tool/call`（id 0）→ `notes_add` → `success:true` → `turn/completed`。
- 教学文件放在仓库根目录（`lessons/`、`reference/`、`assets/`、`labs/`），**不是产品代码**；不要和 `apps/` 混在一起提交。
- 样本代码以 2026-10-28 的 `codex-cli 0.164.0` 为准；升级后先重跑 `codex app-server generate-json-schema --experimental`。
- 本地已生成 schema 到 `.agents/codex-schema/`（gitignored），用于核对字段。
- 交互与布局已用 Playwright（Chrome headless）验证：stepper / quiz / 深链正常；1440 与 390 宽无横向溢出；print media 会展开 stepper。
- 课程 02 的关键教学点：服务端请求 id 是独立命名空间（首轮为 0），原样回传；`success` 与业务 `ok` 是两层语义。
- 下一课需要确认：目标项目里的「领域对象」是什么（一张画布？一份表单？一条记录？），以及哪些动作不可逆。课程 03 会直接用它的第一个写工具做例子。

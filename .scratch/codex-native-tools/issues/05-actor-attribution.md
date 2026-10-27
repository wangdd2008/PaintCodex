# 05: 修正 actor 归属（undo/redo/建画布/改名/删图层）

**What to build:** 把硬编码为 `user` 的 actor 改为由调用方传入，使 AI 触发的撤销与删除在快照、日志里记录为 `agent`。

**Blocked by:** 无

**Status:** done

现状（均硬编码 `'user'`）：

- `apps/daemon/src/paint/service.ts`：`createCanvas`、`renameCanvas`、`undo`、`redo`
- `apps/daemon/src/api/routes.paint.ts`：图层删除（REST create/update 只是默认 `'user'`，可保留默认）

为什么是缺陷而不是重构：`snapshots.actor` 与 `agent_logs.actor` 已经存在，`canvas_undo` 的撤销作用域（切片 2）依赖它判断「栈顶是不是 agent 干的」。归属一旦错，作用域判断就跟着错。

- [x] `PaintService` 的 `createCanvas` / `renameCanvas` / `undo` / `redo` 增加可选 `actor` 参数（默认 `'user'`，保持 REST 行为不变）
- [x] `CommandDispatcher` 透传 `actor`
- [x] REST 路由在调用点显式传 `'user'`（不留隐式默认依赖）
- [x] `routes.ai.ts` / 工具执行器在 AI 触发时传 `'agent'`
- [x] 测试：AI 触发 undo/redo 后，`snapshots.actor` 与画布变更日志均为 `agent`；REST 路径仍为 `user`
- [x] `pnpm -r typecheck`、`pnpm -r test` 通过

## Comments

- `9fe063e` fix(daemon): attribute canvas actor to the caller
- 现状确认：`createCanvas` 的快照与日志、`renameCanvas` / `undo` / `redo` 的日志均取自传入的 `actor`；`undo`/`redo` 本身不写快照（游标移动语义不变），`applyAction` 的快照/日志早已用 `request.actor`。
- 测试（`apps/daemon/test/actor-attribution.test.ts`，新增 4 例）：调用方传 `agent` 时 createCanvas 快照 `actor=agent`、canvas_create 日志为 `agent`，rename/undo/redo 日志为 `agent`；未传 `actor` 时快照/日志回落 `user`；REST 全路径（建画布、改名、建/删图层、undo、redo）日志为 `user`，删除后的最新快照 `actor=user`、`action=canvas_delete_layer`。
- 验证：`pnpm -r typecheck` 通过；`pnpm --filter @paintcodex/daemon test` 19 个文件 / 136 例全绿。
- 未做（已由后续切片补上）：第 4 项（`routes.ai.ts` / 工具执行器传 `agent`）。本票当时只留接缝；切片 2 起的 `apps/daemon/src/paint/agent/runtime/tools.ts` 已在所有写类工具中显式传 `actor: 'agent'`，`actor-attribution.test.ts` 的「actor attribution through the tool executor」用例验证 create/update/delete 的 `snapshots.actor` 均为 `agent`。2026-10-28 复核后勾选第 4 项。
- 2026-10-28 — REST 边界收紧（审查修复）：`POST /paint/canvas/:id/apply-action` 与图层 create/update 不再接受请求体里的 `actor`；REST 写入一律记 `user`，body 里出现非 `user` 的 `actor` 返回 `400 invalid_actor`。`actor:'agent'` 只能来自进程内工具执行器。见 `actor-attribution.test.ts` 的「rejects a REST body that claims the agent actor」。


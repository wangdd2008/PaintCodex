# 11: AI 等待与落地确认

**What to build:** 20 秒的等待不再只剩「AI 正在思考…」：有秒数、有阶段、有终态；生成成功后消费后端已经发送的 `layerCreated`，在对话里给出落地确认与可撤销入口。

**Blocked by:** 02 (错误/状态反馈面)

**Status:** done

**Covers:** UX-14

**Size:** S

## Acceptance Criteria

- [x] 发送后每 1 秒更新「已用 Ns」。
- [x] 首个 `delta` 到达后切换为「正在生成…」；`step` 事件仍按 ADR-0007 的四段文案驱动，不改变序列。
- [x] 完成后保留终态「已完成 · 用时 Ns」，不清空为空白。
- [x] 消费 `layerCreated { id, name }`：助手气泡下显示「已添加图层「AI — 红色圆形」· 撤销」。
- [x] 撤销仅在 `currentRevision === 生成时 revision` 时可用；否则降级为纯文本，不显示撤销入口。
- [x] 撤销只撤该步，不撤后续用户操作。
- [x] 自动化：SSE 注入 `step*` + `layerCreated` + `done`，断言计时文案、终态与确认行的出现顺序。

## Notes

- 图层不会因为前端未消费 `layerCreated` 而丢失：`snapshot_changed` 全量刷新会把它带出来。缺的只有对话内的确认，因此本票不做数据抢救逻辑。
- 后端已在 `routes.ai.ts` 发送该字段，前端零引用；本票只补消费端。

## Comments

**2026-10-26 — implementation commit `c86a499`（基线：fast-forward 合并 `feat/release-hardening` `a1745e2`，无冲突）**

- **等待计时**：`AiChatPanel` 在发送时记录墙钟起点，`setInterval(…, 1000)` 每秒按 `Math.floor((Date.now() - startedAt) / 1000)` 刷新，气泡内状态行同时显示当前 `step` 文案与「已用 Ns」；计时在生成阶段继续走，不只覆盖首个阶段。
- **阶段切换**：首个 `delta` 将消息标为 `generating`，状态行切到「正在生成…」；`step` 序列保持 ADR-0007 的四段，不增删。`action_parse` / `action_apply` 描述结果落地，首个 token 之后仍继续显示，不会一直停在「正在生成…」。
- **终态**：`done` 时按同一墙钟起点结算 `durationSeconds` 写回该条助手消息；`finally` 只清 `currentStep` 与 `inFlight`，终态「已完成 · 用时 Ns」留在气泡内，后续消息也不会覆盖旧气泡的终态。
- **落地确认**：消费 `layerCreated { id, name }`，在该助手气泡下方渲染「已添加图层「{name}」」。记录请求发出时的 `canvasId` 与 `revision`，把 AI 这一步的 `expectedRevision` 定为 `发出时 revision + 1`。
- **撤销守卫**：仅当 `currentRevision === expectedRevision` 且画布 id 相同、未撤销过时渲染「撤销」按钮；revision 已越过（后续笔画、另一标签页、AI 重试）时降级为纯文本「已有后续操作，无法撤销」；快照尚未刷新、`currentRevision` 仍小于目标 revision 时不显示任何撤销入口，避免短暂误报。守卫条件同时排除「运行期间用户又画了一笔」与「切到另一张画布」这两种会撤掉非本步快照的情况。
- **撤销行为**：点击后调用 `canvas-store` 的快照级 `undo()`（沿用 ADR-0003），成功后用图层 id 是否仍存在判断结果，把确认行改为「已撤销添加图层「{name}」」并撤掉按钮。自动化断言撤销请求以 AI 那一步的 revision 作为 `expectedRevision`，且后续 revision 变化后按钮消失。
- **测试**：新增 `apps/web/test/ai-chat-waiting.test.tsx` 5 条（fake timers 的 0s→1s→3s 计时、done 后终态保留、`step→delta→done` 顺序与生成/落地文案切换、`layerCreated` 确认行与 revision 守卫、撤销请求参数与「已撤销」降级）；AI 对话相关 `ai-chat-panel.test.tsx` 12 条 + `ai-chat-waiting.test.tsx` 5 条全部通过（17/17）。
- **门禁数字**：`pnpm --filter @paintcodex/web test` → **20 文件 / 144 条，143 passed / 1 failed**；唯一失败为 `test/layer-panel-keyboard.test.ts > 行内可见性与删除按钮不会触发整行选中`（期望 `window.confirm` 被调用，但票 02 的保存态让删除按钮在可见性 mutation 的 500ms 防抖期内保持 disabled）。该失败在合并基线 `a1745e2` 上以 `git stash` 复跑同样失败，属票 02 与票 08 的既有交叉问题，不在本票范围，未修改。`pnpm -r typecheck` 三包全绿。
- **需人工/浏览器复核**：① 真实 daemon 下 20 秒等待的秒数节奏与状态行视觉（jsdom 只能断言文案，不能验证实际间隔与不跳动）；② 真实 SSE 下 `snapshot_changed` 刷新与 `layerCreated` 的到达先后——撤销按钮应在快照刷新后出现，不应在 1 秒内闪出「已有后续操作」；③ 点击撤销是否只移除该 AI 图层、保留此前笔迹，并把确认行变为「已撤销添加图层」；④ 运行中再画一笔或切换画布后，确认行是否稳定降级为纯文本而不提供撤销。
- **范围**：未改 AI 错误处理（票 12）、未改连接状态（票 13）、未改后端协议与 `routes.ai.ts`；未引入新依赖；撤销仍是快照级（ADR-0003），没有新建局部撤销栈。

**2026-10-26 — 合并后补记**

- 合并 `feat/release-hardening` 最新 `747a2c3`（票 02 修复「成功后立即解除控件禁用，只有显示做防抖」）：merge commit `dc4491e`。无冲突，合并只带入 `apps/web/src/services/canvas-store.ts` 的 6 行修复。
- 合并后门禁：`pnpm --filter @paintcodex/web test` → **20 文件 / 144 passed**（含本票新增 5 条）；`pnpm -r typecheck` 三包全绿。先前记录的 `layer-panel-keyboard` 失败正是 `747a2c3` 修复的交叉问题，现在不再是已知失败。
- 需人工/浏览器复核项不变（上述 ①–④）。

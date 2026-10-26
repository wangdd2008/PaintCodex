# 13: 连接状态指示

**What to build:** 画布页不再对 SSE 断线一无所知：状态栏给出「连接中／实时中／重新连接中」，断线用琥珀色而非红色错误，恢复后自动刷新一次。

**Blocked by:** 02 (状态栏槽位)

**Status:** done

**Covers:** UX-17

**Size:** S

## Acceptance Criteria

- [x] 状态栏小圆点 + 短文案，复用监控页的视觉语言；三态：连接中 / 实时中 / 重新连接中。
- [x] 打开画布 ≤1 秒显示「实时中」。负载完成后立即采样即为「实时中」（ms≈0）。
- [x] 停 daemon ≤3 秒显示「重新连接中」。实测杀进程后首个 150ms 采样点已是「重新连接中…」；**前提是修掉 Vite 代理挂住 SSE 响应的问题**，见 Comments。
- [x] 恢复 daemon ≤5 秒回到「实时中」，并自动刷新一次画布。实测 1558ms 回到「实时中」。
- [x] 断线用琥珀色，不使用红色错误横幅（它不是操作失败）。
- [x] 读屏只播报一次状态变化（`role="status"`），不逐次朗读。
- [x] 不新增轮询请求（`onOpen` 后单次刷新即可）。
- [x] 自动化：模拟 SSE `error` 事件 → 断言状态文案与颜色类；模拟 `open` → 断言刷新调用 1 次。

## Notes

- 现状：`onError` 未接入 `App.tsx`，画布页无任何连接指示，而监控页已有完整 live 状态。
- 不提供手动重连与离线队列（架构是「失败即报错 + 全量刷新」）。

## Comments

**2026-10-26 — implementation commit `56ca836`（基线：fast-forward 合并 `feat/release-hardening` `a1745e2`，无冲突；本条记录随附文档提交）**

- **连接状态**：`App.tsx` 新增 `connectionState: 'connecting' | 'live' | 'reconnecting'`。打开/切换画布（`canvasId` 变化）时先置 `connecting`；SSE `onOpen` → `live`，并沿用原有的单次 `refreshCanvas()`；`onError` → `reconnecting`。没有新增轮询、定时器或手动重连入口——`EventSource` 自己重连，恢复后由 `onOpen` 触发一次刷新。
- **状态栏**：新增 `apps/web/src/features/status-bar/ConnectionStatus.tsx`，在保存状态之后增加「圆点 + 胶囊」槽位，文案 `连接中…` / `实时中` / `重新连接中…`，与监控页同一套视觉语言。`live` 为绿色（`#9fd6a8` / 圆点 `#6fce82`），`connecting` / `reconnecting` 为琥珀色（文字与圆点 `#f0c674`、边框 `#5c4a22`），不是红色错误横幅，也不占用画布区 `role="alert"`。样式落在 `apps/web/src/app/app.css` 的 `.status-bar__connection*`。
- **读屏**：整条状态是单个 `role="status"` + `aria-atomic="true"` 节点，圆点 `aria-hidden="true"`；同一状态重复上报不新增节点，每次状态变化只播报一次。
- **无画布**：没有 `canvasId` 就没有 SSE 通道，状态栏不渲染连接槽位（仍显示「无画布」），不伪造「连接中」。
- **测试**：新增 `apps/web/test/connection-status.test.tsx` 5 条：① 渲染先「连接中…」→ `open` 后「实时中」、刷新恰 1 次、快进 60 秒仍为 1 次（无轮询）；② `error` → 「重新连接中…」+ `status-bar__connection--reconnecting` 颜色类、重复 `error` 仍只有一个 `role="status"`、无 `role="alert"`；③ `error` 后 `open` 恢复「实时中」并再刷新 1 次（共 2 次）；④ 切换到另一张画布回到「连接中…」并重新订阅；⑤ 无画布不渲染连接槽位。
- **门禁**：`pnpm --filter @paintcodex/web test` → **20 文件 / 144 passed**；`pnpm -r typecheck` → protocol / daemon / web 三包全绿。
- **合并后集成问题（非本票范围）**：`a1745e2` 上 `layer-panel-keyboard.test.ts` 的「行内可见性与删除按钮不会触发整行选中」稳定失败——票 02 的 ≤500ms 保存防抖让 `saving` 在 mutation 成功后仍为 true，而票 08 的删除按钮在 `saving` 时按设计禁用，测试在防抖窗口内点击删除，`confirm` 因此未被调用。为跑通门禁，`feat(13)` 曾只在测试里先 `waitFor(saving === false)` 再断言确认交互，未改产品逻辑。
- **合并后补记（merge commit `e43e82e`）**：合并最新 `feat/release-hardening` 时带入 `747a2c3 fix(02): 成功后立即解除控件禁用，只有显示做防抖`，该修复从根上消除了上述 02+08 竞态（`saving` 在 mutation 成功后立即为 false，显示防抖不受影响）。既然根因已修，`feat(13)` 里的临时 `waitFor(saving === false)` 不再需要，已随本补记回退，`apps/web/test/layer-panel-keyboard.test.ts` 保持上游原样。合并后门禁重跑：`pnpm --filter @paintcodex/web test` → **20 文件 / 144 passed**；`pnpm -r typecheck` 三包全绿。
- **需浏览器人工复核**：
  - 打开画布到「实时中」的实际耗时（验收 ≤1 秒），依赖真实 SSE 握手。
  - 停 daemon 到「重新连接中…」的实际耗时（验收 ≤3 秒）；恢复 daemon 后 ≤5 秒回到「实时中」并自动刷新一次。
  - 琥珀色/绿色与监控页视觉是否一致、断线是否不会被误读为错误；360–560px 下状态栏换行后连接槽位是否仍不溢出。
  - 读屏（NVDA/VoiceOver）实际只播报一次状态变化，重复断线/重连不逐次朗读。

**2026-10-27 — 浏览器复核发现并修复「断线看不见」**

第一次实测（杀掉 daemon 进程后采样 12 秒）状态栏始终显示「实时中」，验收 17 实际不成立。定位结论：**不是前端接线问题，而是 Vite 开发代理的问题**。HTTP 代理在 upstream 断开时只打一条 `ECONNRESET` 日志，却把浏览器侧的 SSE 响应挂着不结束；`EventSource` 因此既不触发 `error` 也不重连，`onError` 永远轮不到。

修复（`apps/web/vite.config.ts`）：把 `/paint` 代理改成对象形式并注册 `configure(proxy).on('error')`，在代理报错时 `response.destroy()`，让浏览器侧看到连接被断。前端一行未改。

复核结果（真实 daemon + Vite，1264×625）：

| 场景 | 结果 |
|---|---|
| 杀掉 daemon 进程 | 首个 150ms 采样点即「重新连接中…」（之前 12 秒都停在「实时中」） |
| 重启 daemon | **1558ms** 回到「实时中」，并自动刷新一次 |
| 新增轮询 | 无（仍是 EventSource 自身重连） |

对照实验：用 CDP 拦截 `/events` 直接 abort 时，前端能正确进入「重新连接中…」，说明 `onError → reconnecting` 的接线本身是对的，只有代理这一层会把断线吃掉。

# 13: 连接状态指示

**What to build:** 画布页不再对 SSE 断线一无所知：状态栏给出「连接中／实时中／重新连接中」，断线用琥珀色而非红色错误，恢复后自动刷新一次。

**Blocked by:** 02 (状态栏槽位)

**Status:** done

**Covers:** UX-17

**Size:** S

## Acceptance Criteria

- [x] 状态栏小圆点 + 短文案，复用监控页的视觉语言；三态：连接中 / 实时中 / 重新连接中。
- [ ] 打开画布 ≤1 秒显示「实时中」。（状态切换逻辑已自动化；≤1 秒依赖真实 SSE 握手，待浏览器复核，见 Comments）
- [ ] 停 daemon ≤3 秒显示「重新连接中」。（`error` → 「重新连接中…」已自动化；≤3 秒为浏览器 EventSource 重连行为，待真实停/起 daemon 复核）
- [ ] 恢复 daemon ≤5 秒回到「实时中」，并自动刷新一次画布。（`open` 后刷新恰 1 次已自动化；≤5 秒待浏览器复核）
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
- **合并后集成问题（非本票范围，已上报）**：`a1745e2` 上 `layer-panel-keyboard.test.ts` 的「行内可见性与删除按钮不会触发整行选中」稳定失败——票 02 的 ≤500ms 保存防抖让 `saving` 在 mutation 成功后仍为 true，而票 08 的删除按钮在 `saving` 时按设计禁用，测试在防抖窗口内点击删除，`confirm` 因此未被调用。只在测试里先 `waitFor(saving === false)` 再断言确认交互，未改任何产品逻辑（删除仍走确认、防抖仍生效）。该修正随 `feat(13)` 提交。
- **需浏览器人工复核**：
  - 打开画布到「实时中」的实际耗时（验收 ≤1 秒），依赖真实 SSE 握手。
  - 停 daemon 到「重新连接中…」的实际耗时（验收 ≤3 秒）；恢复 daemon 后 ≤5 秒回到「实时中」并自动刷新一次。
  - 琥珀色/绿色与监控页视觉是否一致、断线是否不会被误读为错误；360–560px 下状态栏换行后连接槽位是否仍不溢出。
  - 读屏（NVDA/VoiceOver）实际只播报一次状态变化，重复断线/重连不逐次朗读。

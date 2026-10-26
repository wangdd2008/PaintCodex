# 12: AI 错误可恢复

**What to build:** AI 失败不再是一条英文报错加一个空气泡：错误按原因分类成中文、内置重试、按规则恢复草稿，并去掉空气泡。

**Blocked by:** 02

**Status:** done

**Covers:** UX-15

**Size:** M

## Acceptance Criteria

- [x] 中文错误分类：daemon 不可达、超时（120s）、5xx、`canvas_required`；界面不再出现 `Failed to fetch`、`AI request failed (status)`。
- [x] 错误条内置「重试」：复用最后一条用户消息与空助手气泡，不追加新的用户消息。
- [x] 失败后输入框为空时才恢复草稿；用户已重新输入则不覆盖。
- [x] 失败气泡标「未完成」，不出现空气泡。
- [x] 超时文案里的「重试」是可点按钮，不是纯文字。
- [x] 主动取消保持现有「已取消」，不进入错误分支、不显示重试。
- [x] 自动化：停 daemon 发送 → 断言中文错误 + 重试按钮；点重试 → 断言用户消息数量不变、请求发出 1 次。

## Notes

- 当前 `catch` 只 `setError`，发送前清空输入且失败不恢复，`Failed to fetch` 会原样显示。
- 本票撤销 `.scratch/ai-chat-ux-improvements/spec.md` 的 `Auto-retry on timeout or error` 排除项（见 spec `## Superseded Decisions`）。

## Comments

**2026-10-26 — implementation commit `0b67b51`（基线：fast-forward 合并 `feat/release-hardening` `6e7e7b7`，无冲突）**

- **错误分类**：新增 `apps/web/src/features/ai-chat/chat-error.ts`，按「网络层 TypeError / `Failed to fetch` → 不可达」「504 或 timeout 文案 → 超时」「`canvas_required` → 先建画布」「`ai_canvas_action_*` → 无效操作 / 落地失败」「5xx → 服务暂不可用」「429 / 其余 4xx → 限流 / 请求未被接受」分类，兜底也输出中文。daemon 返回的原始英文 message 只作为分类输入，不会上屏；`Failed to fetch` 与 `AI request failed (status)` 两条路径都已消除。
- **错误条与重试**：错误条保留 `role="alert"`，内部渲染中文原因 +「重试」按钮。`ChatErrorState` 同时保存失败那一轮的用户原文与助手气泡 id；点击重试时清空该气泡的失败态并原样重发，**不追加**用户消息，也不新建助手气泡。重试请求仍走同一条 `run()`，计时/终态/`layerCreated` 逻辑与票 11 完全一致。
- **草稿恢复**：失败时用 `setInput(current => current.length === 0 ? text : current)`，只有输入框为空才回填失败原文；用户已重新输入则保留新内容。重试时只有输入框仍是刚回填的同一句才清空，避免把用户改写的草稿发出去或清掉。
- **失败气泡**：助手消息新增 `incomplete`。失败后渲染为「正文 + 未完成」；若一字未收到，则「未完成」本身就是气泡占位，不再出现空白气泡。重试与取消都会清掉该标记。
- **超时可点**：超时文案改为「请求超时（等待 120 秒）。」，不再包含不可点的「请重试」纯文字；重试入口就是错误条里的按钮。
- **取消**：仍走 `markAssistantCancelled`，直接标「已取消」并返回，不设置错误条、不显示重试。
- **测试**：新增 `apps/web/test/ai-chat-error.test.tsx` **9 条**（不可达中文 + 重试按钮、5xx 中文、`canvas_required` 中文、超时重试可点、失败气泡「未完成」且无空气泡、空输入恢复草稿、已重新输入不覆盖、重试不追加用户消息且只再发 1 次请求、取消不显示重试）；更新 `apps/web/test/ai-chat-panel.test.tsx` 的 2 条错误断言以匹配中文分类。`pnpm --filter @paintcodex/web test` → **22 文件 / 158 passed**（含本票 9 条）；`pnpm -r typecheck` 三包全绿。
- **需人工/浏览器复核**：① 真实停掉 daemon 后发送，确认错误条是中文、重试按钮在窄侧栏内不换行且可点；② 真实等待 120s 超时，确认错误条出现、重试确实发起新请求；③ 失败后草稿回填、改写后再重试不覆盖新草稿；④ 失败气泡在「零正文」与「半截正文」两种情况下都有「未完成」，不出现空白气泡；⑤ 主动取消仍是「已取消」，没有错误条和重试。
- **范围**：未改票 11 的计时、终态与 `layerCreated` 确认行，未改连接状态（票 13），未引入新依赖；中文引号用「」。

**2026-10-26 — 合并后补记**

- 合并 `feat/release-hardening` 最新 `9c17bd5`（票 04 画布身份、票 10 删除恢复条等）：merge commit `d438db8`，无冲突，本票文件未被改动。
- 合并后门禁：`pnpm --filter @paintcodex/web test` → **24 文件 / 171 passed**（含本票 9 条）；`pnpm -r typecheck` 三包全绿。
- 需人工/浏览器复核项不变（上述 ①–⑤）。

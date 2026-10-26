# 12: AI 错误可恢复

**What to build:** AI 失败不再是一条英文报错加一个空气泡：错误按原因分类成中文、内置重试、按规则恢复草稿，并去掉空气泡。

**Blocked by:** 02

**Status:** ready-for-agent

**Covers:** UX-15

**Size:** M

## Acceptance Criteria

- [ ] 中文错误分类：daemon 不可达、超时（120s）、5xx、`canvas_required`；界面不再出现 `Failed to fetch`、`AI request failed (status)`。
- [ ] 错误条内置「重试」：复用最后一条用户消息与空助手气泡，不追加新的用户消息。
- [ ] 失败后输入框为空时才恢复草稿；用户已重新输入则不覆盖。
- [ ] 失败气泡标「未完成」，不出现空气泡。
- [ ] 超时文案里的「重试」是可点按钮，不是纯文字。
- [ ] 主动取消保持现有「已取消」，不进入错误分支、不显示重试。
- [ ] 自动化：停 daemon 发送 → 断言中文错误 + 重试按钮；点重试 → 断言用户消息数量不变、请求发出 1 次。

## Notes

- 当前 `catch` 只 `setError`，发送前清空输入且失败不恢复，`Failed to fetch` 会原样显示。
- 本票撤销 `.scratch/ai-chat-ux-improvements/spec.md` 的 `Auto-retry on timeout or error` 排除项（见 spec `## Superseded Decisions`）。

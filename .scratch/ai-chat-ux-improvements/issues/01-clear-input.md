# Clear Input Button with Undo

**Status:** done
**Type:** task

## Description

在 AI Chat 输入框旁增加「清空」按钮，支持一键清空当前草稿内容，并提供撤销功能。

## Acceptance Criteria

- [x] 输入框旁出现「清空」按钮（图标或文字），仅在输入框有内容时可见
- [x] 点击「清空」后，`textarea` 内容被清空，按钮变为「撤销」
- [x] 点击「撤销」后，刚才的内容恢复，`lastInput` 重置
- [x] 清空/撤销不影响已发送的对话历史
- [x] 无确认弹窗，直接生效
- [x] 新增前端测试验证清空/撤销交互

## Related

- Spec: `.scratch/ai-chat-ux-improvements/spec.md`
- ADR: `docs/adr/0007-ai-chat-ux-improvements.md`

## Comments

2026-10-25 — Implemented and merged into `feat/ai-chat-ux-improvements`.

- Implementation commit: `3019d45`, merge `4ef6503`; review fixes in `9fc0154`.
- `apps/web/test/ai-chat-panel.test.tsx` 覆盖：空草稿不显示「清空」、清空后切换「撤销」、撤销仅恢复一次、清空/撤销不影响已发送消息、重新输入新草稿后撤销机会作废、发送后不再提供旧草稿撤销。
- Review 修正：清空后重新编辑会丢弃撤销机会，发送时重置 `lastInput`，避免「撤销」覆盖新草稿或复活已发送内容。
- Verification: `pnpm -r typecheck` pass; `pnpm -r test` — web 57 passed, daemon 103 passed.

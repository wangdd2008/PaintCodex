# Clear Input Button with Undo

**Status:** ready-for-agent
**Type:** task

## Description

在 AI Chat 输入框旁增加「清空」按钮，支持一键清空当前草稿内容，并提供撤销功能。

## Acceptance Criteria

1. 输入框旁出现「清空」按钮（图标或文字），仅在输入框有内容时可见
2. 点击「清空」后，`textarea` 内容被清空，按钮变为「撤销」
3. 点击「撤销」后，刚才的内容恢复，`lastInput` 重置
4. 清空/撤销不影响已发送的对话历史
5. 无确认弹窗，直接生效
6. 新增前端测试验证清空/撤销交互

## Related

- Spec: `.scratch/ai-chat-ux-improvements/spec.md`
- ADR: `docs/adr/0007-ai-chat-ux-improvements.md`

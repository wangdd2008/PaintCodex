# 05: 后端错误信息中文化

**What to build:** API 返回的所有错误信息为中文。

**Blocked by:** None（可立即开始）

**Status:** ready-for-agent

## Acceptance Criteria

- [ ] `errors.ts` 中文化：画布不存在、图层不存在、版本冲突等错误消息
- [ ] `routes.paint.ts` 中文化：验证错误信息（宽高范围、图层类型、必填字段等）
- [ ] `routes.ai.ts` 中文化：AI 聊天相关错误信息
- [ ] 后端测试同步更新（`ai-chat.test.ts`、`canvas.test.ts` 等）
- [ ] `pnpm -r typecheck` 和 `pnpm -r test` 通过

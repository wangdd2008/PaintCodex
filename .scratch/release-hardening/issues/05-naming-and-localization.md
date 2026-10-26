# 05: 命名唯一与中文化

**What to build:** 图层名用「最大编号 + 1」保证唯一；界面语言声明改为中文；清掉 8 处本地化遗漏；旧数据只在显示层兜底，不写回数据库。

**Blocked by:** 04 (画布默认名与导出文件名同批改动)

**Status:** ready-for-agent

**Covers:** UX-07, UX-19

**Size:** S

## Acceptance Criteria

- [ ] 图层名取现有「笔迹 N」的最大编号 + 1（不是 `layers.length + 1`）：8 层删第 4 层再画 → 「笔迹 9」；刷新后继续下一个未占用编号。
- [ ] 不自动改名已有图层（避免静默修改用户数据）。
- [ ] `<html lang="zh-CN">`。
- [ ] 白名单之外不出现英文句子：`Untitled`、`Blank 1920 × 1080 canvas`、`vector`、`AI chat`、`PaintCodex canvas`、`Logs:`、`chats`、`Stroke N` 全部消失。
- [ ] 空画布提示为「未创建画布 · 1920 × 1080」；类型显示「笔迹」/「AI」/「图片」；图层默认名「笔迹 N」。
- [ ] 旧画布名为空或仍为 `Untitled` 时，前端显示「未命名」，但**不写回数据库**。
- [ ] 白名单明确保留：`PaintCodex`、`PNG`、`JSON`、`SVG`、`AI`、`Codex CLI`、`traceId`、`http_request`、`sse_subscribe`、`chat_completed`、监控分类名（含 `ai-chat`）。
- [ ] 读屏标签为中文：图层行、行内按钮、画布 `aria-label`。
- [ ] 自动化：断言渲染树中不存在白名单外的英文 UI 字面量（可用快照/字符串扫描）；daemon 默认名测试同步更新。

## Notes

- daemon 默认值、`canvas.test.ts`、导出文件名、旧画布兼容须同批改，否则会出现「新画布中文、旧画布英文」的第三种状态。
- 与票 04 共享默认名逻辑：04 负责「能改名」，05 负责「默认值正确且不污染旧数据」。

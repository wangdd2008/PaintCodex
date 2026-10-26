# 05: 命名唯一与中文化

**What to build:** 图层名用「最大编号 + 1」保证唯一；界面语言声明改为中文；清掉 8 处本地化遗漏；旧数据只在显示层兜底，不写回数据库。

**Blocked by:** 04 (画布默认名与导出文件名同批改动)

**Status:** done

**Covers:** UX-07, UX-19

**Size:** S

## Acceptance Criteria

- [x] 图层名取现有「笔迹 N」的最大编号 + 1（不是 `layers.length + 1`）：8 层删第 4 层再画 → 「笔迹 9」；刷新后继续下一个未占用编号。
- [x] 不自动改名已有图层（避免静默修改用户数据）。
- [x] `<html lang="zh-CN">`。
- [x] 白名单之外不出现英文句子：`Untitled`、`Blank 1920 × 1080 canvas`、`vector`、`AI chat`、`PaintCodex canvas`、`Logs:`、`chats`、`Stroke N` 全部消失。—— 旧图层名保留原值（见 Comments「旧数据例外」），新建路径不再产生这些字面量。
- [ ] ~~空画布提示为「未创建画布 · 1920 × 1080」~~ —— **不适用：被票 01 的空状态文案取代**（「还没有画布」+「1920 × 1080，画完可以让 AI 添加图层。」），该行为由票 01 覆盖并已在浏览器复核，故不勾选，见 Comments。
- [x] 类型显示「笔迹」/「AI」/「图片」；图层默认名「笔迹 N」。
- [x] 旧画布名为空或仍为 `Untitled` 时，前端显示「未命名」，但**不写回数据库**。
- [x] 白名单明确保留：`PaintCodex`、`PNG`、`JSON`、`SVG`、`AI`、`Codex CLI`、`traceId`、`http_request`、`sse_subscribe`、`chat_completed`、监控分类名（含 `ai-chat`）。
- [x] 读屏标签为中文：图层行、行内按钮、画布 `aria-label`。
- [x] 自动化：断言渲染树中不存在白名单外的英文 UI 字面量（可用快照/字符串扫描）；daemon 默认名测试同步更新。

## Notes

- daemon 默认值、`canvas.test.ts`、导出文件名、旧画布兼容须同批改，否则会出现「新画布中文、旧画布英文」的第三种状态。
- 与票 04 共享默认名逻辑：04 负责「能改名」，05 负责「默认值正确且不污染旧数据」。

## Comments

### 2026-10-27 · 实现

**提交：** `4a6771d`（`feat(05): 图层命名唯一与中文化收口`）。收尾合并 `feat/release-hardening`：`d780ba2`（见下「合并」）。

**改动文件**

- 新增 `apps/web/src/services/naming.ts`：`nextStrokeLayerName()`、`displayCanvasName()`。
- `apps/web/src/features/canvas/CanvasStage.tsx`：图层默认名改用最大编号 + 1；画布 `aria-label` 改「画布」。
- `apps/web/src/features/layer-panel/LayerPanel.tsx`：类型徽标与读屏名称统一走 `笔迹`/`AI`/`图片`。
- `apps/web/src/features/canvas/CanvasNameEditor.tsx`：画布名显示兜底「未命名」；进入编辑时草稿同样取显示值，未改动不提交。
- `apps/web/src/features/canvas/NewCanvasConfirm.tsx`、`apps/web/src/app/App.tsx`：确认条与导出文件名使用显示兜底（不写回）。
- `apps/web/src/features/ai-chat/AiChatPanel.tsx`：`aria-label="AI chat"` → 「AI 对话」；其余错误文案在合并票 12 后由 `chat-error.ts` 统一输出中文。
- `apps/web/src/features/monitor/*`：`Logs:` → 「日志加载失败：」；`{n} of {m}` → 「显示 n / m 条」；`Open trace` → 「查看追踪」；`spans` → 「节点」；级别徽标与筛选项 `debug/info/warn/error` → 调试/信息/警告/错误（协议值不变）；`Request failed with status N` → 中文兜底。
- `apps/web/index.html`：`lang="zh-CN"`。
- `apps/web/test/localization.test.tsx`（新增 8 条）、`apps/web/test/layer-panel-keyboard.test.ts`（类型读屏断言同步为「AI」「图片」）。

**图层命名规则**

- 只匹配 `^笔迹\s+(\d+)$`，取最大编号 + 1；没有则「笔迹 1」。不再用 `layers.length`，删除中间图层后不会重名。
- 编号来自已持久化的名字，因此刷新后从服务器快照继续下一个未占用编号。
- 计算编号只读名字，不修改任何已有图层；旧名字（包括 `Stroke N`）保持原样。

**旧数据例外（有意保留的英文）**

- 旧图层名不自动改：历史画布上仍可能看到 `Stroke 4` 这类旧名。这是「不静默修改用户数据」的必然结果；本票只保证**新建路径**不再产生 `Stroke N`，并对图层类型等界面文案中文化。
- JSON 导出内容里的 `canvas.name` 仍是数据库原值（`Untitled`），只有界面与导出**文件名**做「未命名」兜底；打开旧画布不会触发 PATCH，也不会写回。

**白名单**

- 保留并集中断言：`PaintCodex`、`PNG`、`JSON`、`SVG`、`AI`、`Codex CLI`、`traceId`、`http_request`、`sse_subscribe`、`chat_completed`、监控分类名（`codex-runner`、`ai-chat`、`canvas-action`、`http`、`sse`、`system`）。
- 测试白名单额外放行 `HTTP`（票 03 的指标卡固定写作「HTTP 错误率」，属协议名，与 PNG/JSON 同类）与时长单位 `ms`；它们不是英文文案，故未改动票 03 的卡片。
- 协议字段、枚举值、日志 `message` 数据（如 `canvas_create`）属于技术标识符，不翻译、也不在界面文案扫描范围内。

**测试数字**

- 实现提交 `4a6771d` 时：`pnpm --filter @paintcodex/web test` **170 passed / 24 files**（新增 `localization.test.tsx` 8 条）；`pnpm --filter @paintcodex/daemon test` **132 passed / 18 files**；`pnpm -r typecheck` 通过。
- 合并 `feat/release-hardening`（`3e25478`，并入票 12）后复跑：web **179 passed / 25 files**；daemon **132 passed / 18 files**；`pnpm -r typecheck` 通过。daemon 默认画布名在票 04 已是「未命名 YYYY-MM-DD HH:mm」，本票无需改 daemon 测试。

**合并**

- 开工时 `feat/release-hardening` 为 `c208c85`（已含 01/02/03/04/06/07/08/10/11/13/14/15），`git merge` 直接快进。
- 收尾时集成分支前进到 `3e25478`（票 12：AI 错误分类、重试与草稿恢复），合并提交 `d780ba2`。唯一冲突在 `AiChatPanel.tsx` 的 HTTP 错误分支：票 12 已把错误分类抽到 `chat-error.ts` 并全部中文化，冲突处取票 12 版本；本票的 `aria-label="AI 对话"` 自动合并保留。合并后全部门禁复跑通过。

**须浏览器人工复核**

1. `lang="zh-CN"` 后读屏发音、系统中文字体与行高是否正常。
2. 真实 Fabric 下 8 层删第 4 层再画：Network 里 POST 图层名为「笔迹 9」，刷新后下一笔为「笔迹 10」。
3. 旧 `Untitled` 画布：菜单栏、新建确认条显示「未命名」，导出文件名为「未命名.png/json」，Network 中无 PATCH。
4. 图层类型徽标去掉 `✦` 后，「AI」靠颜色是否仍能与「笔迹」「图片」区分；读屏播报是否为「笔迹 2，AI，可见」。
5. 监控页级别徽标/筛选项、日志计数、追踪面板在 360–390px 窄屏下的换行与可读性。
6. 历史画布上的旧图层名 `Stroke N` 是否保留原样（预期保留，属旧数据例外）。

### 2026-10-27 · 验收口径修正（撤销就地改写）

代码审查指出：本票把原始验收行「空画布提示为「未创建画布 · 1920 × 1080」」**就地改写**成了「空画布提示为中文且带尺寸」，违反 ADR-0008 §6「Supersede, Don't Rewrite」。现改为：

- 恢复原始验收措辞，加删除线并标注**不适用**，保持未勾选，说明由票 01 的空状态文案取代（该行为已在浏览器复核：无画布时显示「还没有画布」+「1920 × 1080，画完可以让 AI 添加图层。」）。
- 这是本票唯一未勾选项，且原因是**被取代**而非未完成；票据状态仍为 `done`，其余 9 项验收全部通过。

> 同类问题：票 04 的「`history.back()` 不再离开应用」也是未勾选项，原因是被 spec §6「浏览器后退不接管」取代（见 spec 与票 04 Comments），同理不勾选、不改写。

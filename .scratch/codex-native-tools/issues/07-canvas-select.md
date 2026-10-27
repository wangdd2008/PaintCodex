# 07: canvas_select 工具（AI 指示焦点）

**What to build:** 让 AI 能把用户的注意力引到某个图层或区域上——纯 UI 焦点，不改画布、不落库、不进快照。

**Blocked by:** 无（依赖 01 的运行时与 02 的工具事件行，二者已合入）

**Status:** done

背景：spec 与 ADR-0009 的工具表列了 7 个工具，落地过程中 `canvas_select` 被漏掉（01 只做了读+建，02 做改/删/撤销，04 做预览，06 做导出）。这一票补齐，使代码与文档一致——否则「工具集是刻意的小」就会变成「工具集是随意的少」。

- [x] 声明 `canvas_select`（`{ canvasId, layerId?, region? }`），二选一必填
- [x] 执行时经 SSE 通知前端把该图层设为「选中图层」（`Active Layer`），并短暂高亮；`region` 用于画布上圈出区域
- [x] 不写数据库、不产生快照、不 bump revision、不进撤回栈
- [x] 目标不存在时返回 `{ ok:false, code:'layer_not_found' }`（与其它工具一致，模型可读）
- [x] 前端：图层面板选中 + 画布高亮，3 秒后自动淡出；用户正在绘制时不打断当前笔画
- [x] 测试：工具入参校验（layerId / region 二选一）、成功通知帧、未知图层、Web 侧选中与淡出
- [x] `pnpm -r typecheck`、`pnpm -r test` 连续两次通过

## Comments

2026-10-28 — 由父代理在合并期审计发现：`tools.ts` 只声明了 6 个工具，缺 `canvas_select`。补票而非改文档，因为 ADR-0009 与架构文档已把 7 个工具写成对外契约。

2026-10-28 — 实现提交 `ddf7d54`（`ticket/07-canvas-select`，基于 `d1fa7e3`）。

**行为**：`canvas_select` 声明为第 7 个工具，参数 `{ canvasId, layerId?, region? }`。`layerId` / `region` 必须二选一：都给或都不给都是模型可读的 `invalid_arguments`；`layerId` 不存在返回 `layer_not_found`；`region` 要求 `x/y/width/height` 四个有限数字（宽高 > 0），越界时按画布求交集裁剪，结果带 `clamped: true` 与中文 `message` 说明，而不是失败。执行不碰 `CommandDispatcher`：只读 `service.getCanvas`，无 DB 写入、无快照、无 revision、无撤销项——`tools.test.ts` 用 revision、`snapshots` 行数、`getUndoTarget` 三处断言固定这一点。

**帧的选择**：`StreamPayload` 新增一个可选帧：

```ts
select?: { canvasId: string; layerId?: string; region?: CanvasRegion; clamped?: boolean };
```

理由：现有 SSE 帧都是「每帧最多一个可选成员」的 partial 结构，`select` 与之同构；与 `renderRequest` / `exportRequest` 的关键差别是它**不需要浏览器回执**，因此不建 channel、不占 10s 超时，只在工具结果为 `ok` 时由 runtime 经 `onSelect`（与 `onLayerCreated` 同层）转发一次。没有复用 `notice`：`notice` 是字符串且会被渲染成助手气泡里的一行，塞 JSON 等于把协议细节漏进对话，也表达不了 `region` / `clamped`；`tool` 帧只描述调用状态，`layerCreated` 只服务创建，都不合适。

**Web**：`AiChatPanel` 消费 `select` 帧 → `canvas-store.selectFromAi()`。它设置 `activeLayerId` 但**不** bump `activeLayerRequest`，因此不会触发「显式选择」那条会把工具切到 `select` 的路径（这正是会打断笔画的地方）；`CanvasStage` 用 DOM 覆盖层（不碰 Fabric 对象）画 3 秒高亮，时长与 store 的 3000ms 单一来源；`mouse:down`/`mouse:up`/`path:created` 维护 `isDrawing`，绘制中高亮推迟到笔画结束，且全程不动焦点。

**验证**：`pnpm -r typecheck`、`pnpm -r test` 连续两轮通过（daemon 254、web 224，两轮数字一致）。新增测试：`tools.test.ts`（声明、二选一校验、成功、未知图层、裁剪、无写入）、`ai-select.test.ts`（SSE `select` 帧）、`codex-runtime.test.ts`（runtime 转发）、`ai-select-store.test.ts`（选中/3 秒到期/跨画布忽略）、`ai-select-canvas.test.tsx`（图层与区域高亮、淡出、绘制不被打断）、`ai-chat-select.test.tsx`（帧→活动图层、不抢焦点）。

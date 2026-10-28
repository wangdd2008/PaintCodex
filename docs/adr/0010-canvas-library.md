# ADR-0010: 画布库 — 一次一张活动画布，库负责找回

## Status

Accepted — 2026-10-29. Supersedes the "本轮不做画布列表" decision in `.scratch/release-hardening/spec.md:136` / `:176` and the `replaceState`-only routing decision in `.scratch/release-hardening/issues/04-canvas-identity.md:76`.

## Context

画布的持久化从来不是问题：每次 mutation 都写 SQLite（ADR-0008）。问题在**寻址**：服务端只有 `GET /paint/canvas/:id`，没有集合接口；前端只有 URL + `localStorage` 记住的最后一个 id，加一个内存态、单级的 `previousCanvasId`。

后果是可测量的：

- A → B → C 之后 A 不可达；刷新后连 B 也不可达。
- 用户的每一张画布都还在库里，但界面上只有一张。
- `NewCanvasConfirm` 不得不对用户说「当前画布会保留在本地，但从界面移除，可用『返回上一张』找回」——这句话在描述一个 bug 的补丁，而不是一个功能。

上一轮把「画布列表/画廊/多画布管理」显式列为 Out of Scope，理由是「单级返回即可」。那个理由成立的前提是「用户几乎不会有多张画布」；实际使用中，一张画布 = 一次尝试，多张是常态。

## Decision

### 1. 画布库是找回入口，不是保存动作

「持久化即保存」不变（ADR-0008）。画布库只解决「我画过哪些、在哪」。不新增保存按钮，不把「导出 JSON」升格为工程文件。

### 2. 一次仍然只有一张活动画布

画布库是**上一个视图**（`?page=canvases`），不是标签页系统。状态槽、SSE 订阅、AI 请求的 `canvasId` 都保持单值。

这是刻意的：现有的实时模型是「一个画布一条 SSE、一条 Codex thread、一个 revision 序列」（ADR-0004、ADR-0009）。多开会让每个订阅、每次 prompt 的归属都变成矩阵，而收益（同时看两张画布）远小于成本。想对照两张画布的人可以开两个浏览器标签——这条路径本来就被支持（409 冲突刷新重试）。

### 3. 集合语义放在服务端

`GET /paint/canvas`（分页、排序、`layerCount`、`hasThumbnail`）与 `DELETE /paint/canvas/:id`（级联 + 清 Codex thread）。列表在服务端聚合，而不是让客户端逐个 `GET /paint/canvas/:id`——后者在 20 张画布时就是 20 次往返。

### 4. 缩略图由浏览器生成、服务端存储

daemon 没有渲染能力（现有 preview 也是把渲染请求发回浏览器），所以缩略图只能在画布被打开时由 Fabric 渲染并上传，存在独立的 `canvas_thumbnails` 表。列表只返回 `hasThumbnail`，不返回字节。

### 5. 浏览器后退回库

进入画布 `pushState`，后退回库。这撤销了「不为画布切换新增历史条目」的旧决定——当时没有「上一级」可返回，接管后退只会把用户弹到应用外；现在库就是上一级。

## Consequences

- **Positive**: 每张画布都可达；「上一张」这种临时机制退场。
- **Positive**: 删除画布终于有入口，且级联已经由 schema 保证。
- **Positive**: 新建不再有「丢失」风险，确认条可以退场（`NewCanvasConfirm` 的文案随之消失）。
- **Negative**: 多了一张表（`canvas_thumbnails`）、两个接口和一个 400 行的视图。
- **Negative**: 画布库不实时刷新——别的标签页新建的画布要重新进入库才可见。
- **Trade-off**: 用「一次一张 + 库」换掉了「多开标签页」。代价是来回切换有加载成本；换来的是实时模型不用改。

## Alternatives Considered

| Alternative | Rejected Because |
|---|---|
| 顶部标签页多开 | 每个标签页要自己的 SSE、Codex thread、revision 序列；与 ADR-0004 的全量快照模型冲突 |
| 侧栏常驻画布列表 | 侧栏已经要装图层 + 对话，再加一列会把画布挤到不可用 |
| 只做「最近 10 张」下拉 | 不能删除、不能命名管理，等于把问题推后一轮 |
| 缩略图由服务端生成 | daemon 没有渲染器；引入 headless 渲染是另一个量级的依赖 |
| 软删除 / 回收站 | 没有回收站 UI 的软删除只是「删不掉」 |

## Migration Path

1. 新增 `canvas_thumbnails` 表（`CREATE TABLE IF NOT EXISTS`，不改 `canvases`）。
2. 实现 `GET /paint/canvas`、`DELETE /paint/canvas/:id`、缩略图的 `PUT`/`GET`。
3. 新增 `?page=canvases` 视图与 `pushState` 路由。
4. 删除 `previousCanvasId` / `returnToPreviousCanvas` / 「返回上一张」/ `NewCanvasConfirm`。
5. 会话记录改为按 `canvasId` 分区。

# 画布库与多画布

> 服务端早就在保存，缺的是「找回」。本轮把画布从「一个匿名文档」变成「库里的一张文档」，并让对话记录跟着画布走。

## Problem Statement

每次画布变更都已经落库（ADR-0008），但用户实际上只能看见最后一张：

1. **没有列表入口。** 服务端没有 `GET /paint/canvas`，也没有 `DELETE /paint/canvas/:id`；前端只有 `localStorage` + URL 记住的最后一个 id，加一个**内存态、单级**的 `previousCanvasId`。刷新后指针消失，A → B → C 之后 A 不可达。
2. **新建后旧对话留在屏幕上。** `messages` 是 `AiChatPanel` 的组件内状态（`AiChatPanel.tsx:329`），面板从不为 `canvasId` 重建。于是旧气泡继续显示，而下一条消息被发送到**新画布**的 thread——UI 与模型上下文同时错位。
3. **画布库的缺席是被人为关掉的。** `.scratch/release-hardening/spec.md:136` 写「本轮不做画布列表」，`:176` 把「画布列表/画廊/多画布管理」列入 Out of Scope。本轮显式重新开启，因为「画过的画布找不回来」已经比当年的收益更高。

## Solution

三件事：

- **服务端提供集合语义**：列表、删除、缩略图。
- **新增画布库视图**（`?page=canvases`），承担「找回」；画布仍是**一次一张**的活动文档。
- **对话记录按画布分区**，切走即中断在飞请求，不引入服务端对话持久化（沿用 UX-24）。

## User Stories

1. 作为用户，我想看到我画过的所有画布（缩略图、名称、尺寸、图层数、更新时间），以便决定打开哪一张。
2. 作为用户，我想从画布库打开任意一张画布，并且浏览器后退能回到库。
3. 作为用户，我想删除不要的画布，并且删掉之后它不会在库里继续占位。
4. 作为用户，我想新建画布后立刻开始画，不用先关掉上一张的对话。
5. 作为用户，我想在切回某张画布时看到**属于它**的对话，而不是上一张的。
6. 作为用户，我在 AI 跑到一半时切走画布，不希望后台继续改那张我看不见的画布。
7. 作为用户，我在库里删除画布时希望先确认，并且确认框里写清楚是哪一张。
8. 作为维护者，我不希望「返回上一张」这种为了弥补缺失入口而生的临时机制继续留在代码里。

## Scope

| # | 主题 | 票 |
|---|---|---|
| 1 | 画布列表接口 `GET /paint/canvas` | 01 |
| 2 | 画布删除接口 `DELETE /paint/canvas/:id` | 02 |
| 3 | 缩略图：懒生成、独立存储、列表标记 | 03 |
| 4 | 画布库视图与路由历史 | 04 |
| 5 | 对话记录按画布分区 | 05 |
| 6 | 「返回上一张」退场、新建确认条退场 | 06 |

## Implementation Decisions

### 1. 画布仍是一次一张

`canvas` 状态槽、SSE 订阅、`POST /paint/ai/chat` 的 `canvasId` 都保持单值模型。画布库只是**上一个视图**，不引入标签页、分屏或并行订阅。多开的替代品是「同一个 id 开两个浏览器标签」，这条能力本来就有（409 冲突刷新重试）。

### 2. 列表接口

```http
GET /paint/canvas?limit=50&offset=0&sort=updated
200 → {
  items: [{
    id, name, width, height, backgroundColor,
    layerCount, revision, hasThumbnail, thumbnailRevision,
    createdAt, updatedAt
  }],
  total, limit, offset
}
```

- `sort` 只接受 `updated`（默认，`updatedAt DESC`）与 `created`（`createdAt DESC`）——只读排序，不改写任何行。
- `limit` 1–100，默认 50；`offset` ≥ 0。
- `layerCount` 用子查询 `(SELECT COUNT(*) FROM layers WHERE canvasId = canvases.id)`；现有 `layers_canvas_zindex` 索引覆盖。
- `hasThumbnail` / `thumbnailRevision` 由 `LEFT JOIN canvas_thumbnails` 得到，**不返回图片字节**。
- 时间范围、搜索、标签一律不做。

### 3. 删除接口

```http
DELETE /paint/canvas/:id
204 → 无 body
404 → {"error":{"code":"canvas_not_found","message":"画布不存在"}}
```

- 顺序：事务内 `DELETE FROM canvases WHERE id = ?`（`layers`/`snapshots`/`canvas_thumbnails` 由 `ON DELETE CASCADE` 清理，`PRAGMA foreign_keys = ON` 已在 `openDatabase` 打开），提交**之后**再调 `runtime.deleteThread(canvasId)`。
- `deleteThread` 失败不回滚删除：画布已经不在库里，留下一个孤儿 Codex thread 只是磁盘垃圾；记 `codex-runtime/thread_delete_failed`（`warn`）即可。
- 删除是**硬删除**，没有回收站、没有 `archived` 列。

### 4. 缩略图

独立表，避免列表查询拖着二进制：

```sql
CREATE TABLE IF NOT EXISTS canvas_thumbnails (
  canvasId  TEXT PRIMARY KEY,
  revision  INTEGER NOT NULL,
  width     INTEGER NOT NULL,
  height    INTEGER NOT NULL,
  bytes     BLOB NOT NULL,
  updatedAt INTEGER NOT NULL,
  FOREIGN KEY (canvasId) REFERENCES canvases(id) ON DELETE CASCADE
);
```

```http
PUT /paint/canvas/:id/thumbnail
body: { imageUrl: string, revision: number }
204
400 invalid_thumbnail   // 非 data:image/png;base64、解码后 > 256 KB、revision 非整数
404 canvas_not_found

GET /paint/canvas/:id/thumbnail
200 image/png, Cache-Control: no-store
404 thumbnail_not_found
```

- **生成方是浏览器**：daemon 没有渲染能力（现有 preview 也是把渲染请求发回浏览器）。
- 触发时机：画布加载完成、没有在途 mutation、且距最后一次变更 ≥ 800 ms；渲染 320×180（`multiplier` 按画布宽度算）。
- 只在 `thumbnailRevision !== canvas.revision` 时上传，避免切来切去反复生成。
- 上传失败静默（`debug` 日志），不打扰画画。
- 从未打开过的画布没有缩略图，卡片用「背景色块 + 名称首字」占位。

### 5. 路由与浏览器历史

`AppView` 从 `'canvas' | 'monitor'` 扩成 `'canvas' | 'canvases' | 'monitor'`：

| URL | 视图 |
|---|---|
| `/` 或 `?canvasId=…` | 画布 |
| `?page=canvases` | 画布库 |
| `?page=monitor` | 监控 |

- 进入一张画布 → `pushState`（历史上多一条），后退回到库。
- 新建成功后 → `replaceState`（历史里不留下「刚建好的画布」和「建之前的空页」两条）。
- `popstate` 时按 URL 重算视图；若落在画布视图且 `canvasId` 与当前不同 → `loadCanvas`；若 id 缺失或 404 → 跳画布库。

这**推翻了** `release-hardening/issues/04-canvas-identity.md:76` 的「不为画布切换新增历史条目」决定。理由：当时没有「上一级」可返回，接管后退只会把用户弹到应用外；现在有了库，后退回库才是预期语义。

### 6. 对话记录按画布分区

- 新增 `useChatStore`：`transcripts: Record<string, ChatMessage[]>`，键是 `canvasId`。
- `AiChatPanel` 的 `setMessages` 全部改为写 `transcripts[runCanvasId ?? 当前 canvasId]`；发送时捕获的 `runCanvasId` 已经是现存机制（`AiChatPanel.tsx:348-349`）。
- 画布切换 / 新建时：先 `abort()` 在飞请求，再向**发起时那张**画布的桶追加一条「已取消」，然后切换到新桶。
- 服务端不存对话（沿用 UX-24：画布在 SQLite，对话是会话态）。
- **2026-10-29 修订**：桶写 `sessionStorage`（键 `paintcodex.chat.transcripts.v1`），会话边界从「一次页面生命周期」放宽到「一个标签页生命周期」——同标签页刷新/切视图不再丢记录，关标签页仍然清空，服务端仍然不存对话。理由：收起对话列曾经没有可见的展开入口（见票 ②01 回归修复），用户只能靠刷新回来，而刷新会把记录清空，两件事叠加就成了「记录莫名消失」。恢复时收敛在飞残留：`generating` 记作 `incomplete`、运行中工具判失败、挂起确认条置 `expired`。
- 不设条数上限；存储损坏或配额写满时退回空记录，内存会话照常继续。画布硬删除时同步丢弃它的桶。

### 7. 「返回上一张」与新建确认条退场

- 删除 `previousCanvasId`、`returnToPreviousCanvas`、菜单里的「返回上一张」按钮。
- **删除 `NewCanvasConfirm`**：确认条存在的理由是「旧画布会从界面移除、可能找不回来」（`NewCanvasConfirm.tsx:49`），而画布库让这句话不再成立。新建变成一次普通操作，一键完成。

  这是本 spec 里**唯一**一件用户没有逐条批准的事——它由画布库直接推出。若不同意，保留确认条只需不改这一条，其余不受影响。

## Testing Decisions

- 列表接口：空库返回 `items: []` 且 `total: 0`；`layerCount` 与真实图层数一致；`sort` 非法值返回 `400`；`limit` 越界返回 `400`。
- 删除接口：删掉后 `GET /paint/canvas/:id` 返回 404；`layers`/`snapshots`/`canvas_thumbnails` 行数归零（级联断言）；`deleteThread` 抛错时删除仍然成功且返回 204。
- 缩略图接口：非法 data URL / 超限 / 非整数 revision 返回 400；`GET` 在无图时 404、有图时 `Content-Type` 正确。
- 前端：切画布后新画布的桶为空、旧画布桶保留原消息；切走时 `abort` 被调用；后退能回到库（jsdom 里断言 `popstate` 后的视图）。
- 无浏览器 E2E；画布库的视觉验收按 spec 手测。

## Out of Scope

- 回收站 / 软删除 / 归档。
- 画布搜索、标签、文件夹、收藏。
- 同时打开多张画布（标签页 / 分屏）。
- 服务端对话持久化与历史恢复。
- JSON 导入、`.aipaint` 工程文件（ADR-0008 明确留给后续）。
- 画布库的实时刷新（进入库时拉一次；别的标签页新建的画布要重新进入才可见）。

## Superseded Decisions

| 原决定 | 出处 | 本轮改为 |
|---|---|---|
| 「本轮不做画布列表」 | `.scratch/release-hardening/spec.md:136` | 做画布库 |
| 「画布列表/画廊/多画布管理（单级返回即可）」列入 Out of Scope | `.scratch/release-hardening/spec.md:176` | 纳入本轮 |
| 画布切换不新增历史条目 | `.scratch/release-hardening/issues/04-canvas-identity.md:76` | 进入画布 `pushState`，后退回库 |
| 新建前必须确认 | 同上（票 04 验收） | 确认条退场，见实现决定 §7 |
| 对话是面板内部状态 | UX-24（`product-audit/report.md:325`） | 对话仍是会话态，但按画布分区 |

## Further Notes

- 「保存」的语义不变：持久化即保存（ADR-0008）。画布库是**找回入口**，不是保存动作；「导出 JSON」仍是备份，不是可回灌的工程文件。
- 画布库上线后，`NewCanvasConfirm` 的那句「当前画布会保留在本地，但从界面移除」必须消失——它描述的机制不存在了。

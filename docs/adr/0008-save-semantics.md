# ADR-0008: 保存语义 — 持久化即保存，导出是备份

## Status

Accepted — 2026-10-26. Supersedes the 30-second auto-export specified in `.scratch/canvas-save-and-localization/spec.md` (User Story 2) and delivered by `issues/02-auto-save.md`.

## Context

Phase 1 里有两个都叫「保存」的东西：

1. **服务端持久化**：每次画布 mutation 写入 SQLite，刷新与多标签同步都依赖它。用户完全看不见。
2. **30 秒自动下载 JSON**：`.scratch/canvas-save-and-localization/` 明确要求的功能，用户故事是「别丢工作」。实现是 `window.setInterval(30_000)` + `downloadCanvasJson`，静默触发。

现场审计发现了它的实际后果：

- 新建画布空闲 33 秒即产生一次 `Untitled.json` 下载；所有画布都叫 `Untitled`，多张画布互相覆盖。
- 下载的文件无法回灌——Phase 1 与当前路线图都不做导入。因此它不是「保存」，是**无法恢复的备份**。
- 真正的持久化失败只在顶栏显示 12px 红字，同时 `canvas.remove(path)` 把失败的笔画静默吃掉。
- 用户由此得到两种相反的错误认知：以为「保存了」（其实只得到一份不可用文件），以及真正失败时以为「画没了」（其实只是这一笔没落库）。

这个决定的困难不在于「自动下载好不好」，而在于它已经通过了 spec、ADR 之外的完整流程（spec + 已勾选验收 + `Status: done`）。撤销它需要先承认：原始用户故事是对的，交付的机制是错的。

## Decision

### 1. 持久化即保存（Persistence is Saving）

服务端每次画布变更写入存储，即视为保存。用户不需要、也不应该有点「保存」的动作；界面必须把这件事的状态显示出来：`保存中` / `已保存 · 相对时间` / `保存失败 · 重试`。

### 2. 导出是备份（Export is a Backup）

PNG/JSON 下载只在用户显式操作时发生，不承担保存职责，也不代表内容曾成功持久化。JSON 的定位是「可读的备份」，不是「可恢复的工程文件」——导入属于 Phase 2+。这一条与 [ADR-0005](/docs/adr/0005-client-side-png-export.md) 一致：导出是客户端行为，服务端不做导出。

### 3. 移除 30 秒自动下载（Remove the Auto-download）

删除 `App.tsx` 中的自动下载 effect。撤销的是**机制**，不是**意图**：原始用户故事「别丢工作」由第 1、2、5 条承接。

### 4. 保存状态成为唯一真相（One Save Status）

保存状态只反映持久化，三种取值，常驻状态栏；连续笔画用 ≤500ms 防抖避免闪烁。任何「导出成功」的提示都不得复用保存状态的槽位。

### 5. 失败不得吞掉笔画（Never Discard a Stroke Silently）

持久化失败时保留笔画、标记未保存、提供重试；只有当重试必然产生重复对象（Fabric 对象无法与服务端快照对齐）时，才退化为「移除 + 明示这一笔未保存」。任何情况下都不得静默 `canvas.remove(path)`。

### 6. 原始票只追加评论（Supersede, Don't Rewrite）

`.scratch/canvas-save-and-localization/issues/02-auto-save.md` 保持 `Status: done`——它确实按当时的验收标准交付了。改为追加 `## Comments`，指向本 ADR 与 `.scratch/release-hardening/spec.md`。历史不改写，否则下一个读票的人会以为是实现跑偏而不是决策变更。

## Consequences

- **Positive**: 用户只剩一个「保存」概念，而且它的状态可见。
- **Positive**: Downloads 目录不再被静默污染；同名互覆随画布命名一起消失（release-hardening 票 04/05）。
- **Positive**: 失败可重试，笔画不再被吞。
- **Negative**: 用户失去「每 30 秒一份本地文件」的兜底。若 daemon 长期离线且用户从不主动导出，本地没有任何副本。
- **Negative**: 保存状态引入新状态机与防抖，边界（防抖窗口、相对时间刷新频率、失败后重试的 revision 对齐）需要测试覆盖。
- **Trade-off**: 选择「服务端持久化即可信」而不是「本地文件即可信」。代价是把数据安全押在 daemon 的存储上；换来的是与现有架构（每次 mutation 落库 + SSE 全量推送）一致，不引入第二条数据通路。

## Alternatives Considered

| Alternative | Rejected Because |
|---|---|
| 保留 30 秒自动下载，另加保存状态 | 两套「保存」并存，用户仍然会把下载当成保存；文件不可回灌，「恢复」是假的 |
| 改成每 30 秒在 IndexedDB 存一份 | 引入第二套持久化与冲突规则，与 ADR-0004 的全量刷新模型冲突，且没解决「用户以为保存了」的认知问题 |
| 加显式「保存」按钮，点击才落库 | 服务端已经在每次 mutation 落库；按钮会制造「不点就不保存」的新错误认知 |
| 用 `beforeunload` 拦截未保存状态 | 落库是逐次 mutation 的，不存在「未保存的整幅画」；拦截只会制造假警报 |
| 把 JSON 导出升格为可导入的工程文件 | `.aipaint` 与导入已由 Phase 1 spec 明确排除，属新模块，不在本轮 |

## Migration Path

1. 删除 `apps/web/src/app/App.tsx` 的自动下载 effect（`setInterval` + `downloadCanvasJson`）。
2. 状态栏接入保存状态（release-hardening 票 02）。
3. 失败路径改为「保留 + 重试」，去掉 `CanvasStage` catch 里的 `canvas.remove(path)`（同票）。
4. 在 `02-auto-save.md` 追加 `## Comments`，指向本 ADR。
5. 在 `.scratch/product-audit/report.md` 追加勘误：原文「全仓无 ADR/票据依据」错误，spec 与票均在。

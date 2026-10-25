# 监控页

## 入口与导航

- 菜单栏「监控」进入 `?page=monitor`；监控视图中按钮变为「返回画布」。
- 画布工作区保持挂载但 CSS 隐藏，以便返回后保留 AI 对话和画布状态。
- 监控页可访问性树包含 200 条日志行，快照非常大（现场输出约 6.8 万字符）。

## 现场状态（5 分钟窗口）

```json
{
  "live": "实时中",
  "stats": [
    "请求/秒 0.08",
    "请求数 24",
    "错误率 0.0% 1 个错误",
    "平均耗时 5ms",
    "AI 成功率 0.0% 0 / 1 chats"
  ],
  "logs": [
    "02:17:30.154 INFO http http_request 6ms ...",
    "02:17:30.143 INFO http http_request 10ms ...",
    "02:16:57.122 INFO http http_request 5ms ...",
    "02:16:57.052 INFO sse sse_subscribe — —",
    "02:16:57.037 INFO http http_request 1ms ..."
  ]
}
```

- 实时状态显示「实时中」，SSE 正常。
- 日志缓存显示「200 条日志已缓存」，列表显示 `200 of 200`。
- 分类条：codex-runner、ai-chat、canvas-action、http、sse、system。
- 过滤器：分类、级别、时间窗口。
- 点击带 traceId 的日志行可打开右侧「追踪」面板。

## 统计口径矛盾：1 个错误，错误率 0.0%

- 统计卡「错误率」显示 `0.0%`，同一张卡 hint 显示 `1 个错误`。
- `repository.stats()` 中：
  - `errorCount` = 所有分类中 `level='error'` 的数量。
  - `errorRate` = `httpFailureCount / requestCount`，只统计 `category='http'` 且 level 为 warn/error 的记录。
- 因此一个 `ai-chat` 的 error 会让 hint 变成 1，但不会进入错误率分子，出现“0.0% 但有 1 个错误”的自相矛盾。
- 这是指标口径与文案不一致，不是数据丢失。

## AI 成功率把“主动取消”算作失败

现场监控窗口内：

- `AI 成功率 0.0%`，`0 / 1 chats`。
- 唯一的 `chat_completed` 是取消的那次，记录为 `level: "warn"`、`aborted: true`。
- 之前成功的 `chat_completed` 是 `level: "info"`，但已不在当前 5 分钟窗口内。
- `repository.stats()` 只把 `level='info'` 的 `chat_completed` 计为成功，取消会计入分母但不计成功。

产品含义：

- 用户主动取消被当作“AI 失败”，会拉低成功率。
- 如果取消是正常操作，应该单列“取消率”，或从成功率分母中剔除。
- 当前 UI 没有解释这个口径。

## 日志分页与浏览

- 前端固定 `LOG_FETCH_LIMIT = 200`。
- 页面显示 `200 of 200`，没有“加载更多”、页码或虚拟滚动。
- 如果窗口内超过 200 条，更早的记录只能通过缩小时间窗口/分类过滤查看，不能在当前列表中继续翻页。
- 表格行高约 30px，200 行造成很长的页面；缺少密度切换或分页。

## 错误与空状态

- 日志加载失败显示 `Logs: ...`（英文前缀 + 后端中文消息），`role="alert"`。
- 统计失败只在统计面板内显示错误。
- 空日志时有 `monitor-empty` 文案。
- 实时状态区分连接中/实时中/重新连接中/已暂停；暂停时停止订阅。

## 监控页的本地化

- 大多数 UI 文案为中文。
- 技术分类名、日志消息 `http_request`、`sse_subscribe`、`chat_completed` 保持英文，目标用户是开发者，可接受。
- `Logs:` 前缀、`chats` 单位、`Polling` 类状态（如出现）没有统一中文。

## 可引用的源码位置

- `apps/web/src/features/monitor/MonitorPage.tsx`：固定 200 条、5 秒统计刷新、暂停/继续。
- `apps/web/src/features/monitor/StatsPanel.tsx`：错误率、AI 成功率展示。
- `apps/daemon/src/observability/repository.ts`：`errorRate` 只算 HTTP，`aiChatSuccessRate` 只算 info。
- `apps/daemon/src/api/routes.monitor.ts`：查询、追踪、SSE。
- `apps/web/src/features/monitor/monitor.css`：表格与响应式断点。

## 待 PM 判断

1. “错误率 0.0% / 1 个错误”是否应定为 P0 数据可信度问题？
2. 取消是否应计入 AI 成功率？监控是给开发者还是给产品/运营看？
3. 200 条上限是否需要分页/加载更多，还是 Phase 1 可接受？
4. 监控页的英文技术词是否应保留？

import type {
  Actor,
  LogCategory,
  LogComponent,
  LogLevel,
} from '@paintcodex/protocol';

export interface NewAgentLogRecord {
  traceId?: string | null;
  spanId?: string | null;
  parentId?: string | null;
  timestamp?: number;
  level?: LogLevel;
  category: LogCategory;
  message: string;
  payload?: unknown;
  durationMs?: number | null;
  error?: string | null;
  canvasId?: string | null;
  revision?: number | null;
  actor?: Actor | null;
  /** 消息的发出方；内部事件留空（undefined → NULL）。 */
  source?: LogComponent | null;
  /** 消息的接收方；内部事件留空（undefined → NULL）。 */
  target?: LogComponent | null;
}

export interface AgentLogQuery {
  category?: LogCategory | LogCategory[];
  level?: LogLevel | LogLevel[];
  traceId?: string;
  canvasId?: string;
  since?: number;
  until?: number;
  limit?: number;
  offset?: number;
}

export interface AgentLogStatsOptions {
  /** Aggregation window ending at `now`. Defaults to five minutes. */
  windowMs?: number;
  now?: number;
}

/**
 * 追踪摘要（monitor-readability ③03）的查询参数。窗口必须带：
 * 没有 `timestamp >= since` 的约束，`GROUP BY trace_id` 会随 `agent_logs`
 * 无界增长退化为全表扫描（ADR-0012 的已知代价）。
 */
export interface TraceSummaryOptions {
  /** 窗口长度（毫秒），结束于 `now`。默认 900_000（15 分钟）。 */
  windowMs?: number;
  /** 注入当前时间，便于测试固定窗口。 */
  now?: number;
  limit?: number;
  offset?: number;
  /** 只保留触碰过该画布的追踪（画布页下钻用）。 */
  canvasId?: string;
  /** 为 true 时只返回 errorCount > 0 的追踪。 */
  hasError?: boolean;
}

/** 拓扑快照（monitor-readability ③06）的查询参数；窗口同样是硬约束。 */
export interface TopologyOptions {
  /** 窗口长度（毫秒），结束于 `now`。默认 300_000（5 分钟）。 */
  windowMs?: number;
  /** 注入当前时间，便于测试固定窗口。 */
  now?: number;
}

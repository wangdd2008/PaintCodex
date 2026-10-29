import type {
  AgentLog,
  LogCategory,
  LogLevel,
  MonitorCategoryStats,
} from '@paintcodex/protocol';

// 组件标签与方向格式化的唯一实现位于 log-format.ts（同时服务追踪列表
// 「组件路径」列与原始日志/层级树方向列）；这里 re-export 以兼容既有引用。
export { COMPONENT_LABELS, formatDirection } from './log-format';

export type LogRange = '5m' | '15m' | '1h' | 'all';

export type LogCategoryFilter = LogCategory | 'all';

export type LogLevelFilter = LogLevel | 'all';

export interface LogFilterState {
  category: LogCategoryFilter;
  level: LogLevelFilter;
  range: LogRange;
}

export const DEFAULT_LOG_FILTERS: LogFilterState = {
  category: 'all',
  level: 'all',
  range: 'all',
};

/**
 * 级别的界面说法。协议里的 `debug/info/warn/error` 保留为筛选值，
 * 只把展示文字中文化，请求参数不受影响。
 */
export const LOG_LEVEL_LABELS: Record<LogLevel, string> = {
  debug: '调试',
  info: '信息',
  warn: '警告',
  error: '错误',
};

export function formatLogLevel(level: LogLevel): string {
  return LOG_LEVEL_LABELS[level];
}

export const LOG_RANGE_MS: Record<Exclude<LogRange, 'all'>, number> = {
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
};

/** Converts a relative range into the absolute `since` timestamp for the API. */
export function rangeToSince(range: LogRange, now = Date.now()): number | undefined {
  return range === 'all' ? undefined : now - LOG_RANGE_MS[range];
}

export type LogSortField = 'timestamp' | 'durationMs';

export type SortDirection = 'asc' | 'desc';

export interface LogSort {
  field: LogSortField;
  direction: SortDirection;
}

export const DEFAULT_LOG_SORT: LogSort = { field: 'timestamp', direction: 'desc' };

/**
 * The live log buffer keeps at most this many records.聚合在服务端
 * （GET /monitor/traces），客户端只缓冲逐条视图用的窗口；200 条凑不齐
 * 任何一个完整追踪——这是有意为之，不是容量不足（monitor-readability ③04）。
 */
export const MAX_LOG_BUFFER = 200;

export function filterLogs(
  logs: readonly AgentLog[],
  filters: LogFilterState,
  now = Date.now(),
): AgentLog[] {
  const cutoff = filters.range === 'all' ? null : now - LOG_RANGE_MS[filters.range];

  return logs.filter(
    (log) =>
      (filters.category === 'all' || log.category === filters.category) &&
      (filters.level === 'all' || log.level === filters.level) &&
      (cutoff === null || log.timestamp >= cutoff),
  );
}

/**
 * Sorts a copy of the log list. Logs without a duration always come last so
 * they never bury the measured spans, regardless of the sort direction.
 */
export function sortLogs(logs: readonly AgentLog[], sort: LogSort): AgentLog[] {
  return [...logs].sort((left, right) => compareLogs(left, right, sort));
}

/** Deduplicates incoming records by id and keeps the newest `limit` records. */
export function mergeLogs(
  existing: readonly AgentLog[],
  incoming: readonly AgentLog[],
  limit = MAX_LOG_BUFFER,
): AgentLog[] {
  const byId = new Map<number, AgentLog>();

  for (const log of existing) {
    byId.set(log.id, log);
  }

  for (const log of incoming) {
    byId.set(log.id, log);
  }

  // 逐条视图按落库顺序（id DESC）：span 完成记录回溯写入开始时间，
  // 按 timestamp 排会让完成记录排在开始记录上面（spec §5）。
  return [...byId.values()]
    .sort((left, right) => right.id - left.id)
    .slice(0, Math.max(1, Math.trunc(limit)));
}

export function formatDuration(durationMs: number | null | undefined): string {
  if (durationMs === null || durationMs === undefined) {
    return '—';
  }

  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return '—';
  }

  const rounded = Math.round(durationMs);

  if (rounded < 1000) {
    return `${rounded}ms`;
  }

  const seconds = durationMs / 1000;

  return seconds < 10 ? `${seconds.toFixed(2)}s` : `${seconds.toFixed(1)}s`;
}

/** Local wall-clock time with millisecond precision, e.g. `14:03:27.081`. */
export function formatTimestamp(timestamp: number): string {
  if (!Number.isFinite(timestamp)) {
    return '—';
  }

  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
    date.getSeconds(),
  )}.${String(date.getMilliseconds()).padStart(3, '0')}`;
}

/** Formats a ratio as a percentage; unknown ratios render as a dash. */
export function formatPercent(ratio: number | null | undefined): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) {
    return '—';
  }

  return `${(ratio * 100).toFixed(1)}%`;
}

export interface HttpErrorHintInput {
  httpFailureCount: number;
  httpConflictCount: number;
  requestCount: number;
}

/**
 * `0 失败 · 2 冲突 / 24 请求`: both numerators and the denominator stay on the
 * card, so the rate above it can be recomputed by hand.
 */
export function formatHttpErrorHint(input: HttpErrorHintInput): string {
  return `${input.httpFailureCount} 失败 · ${input.httpConflictCount} 冲突 / ${input.requestCount} 请求`;
}

export interface AiChatHintInput {
  aiChatSuccessCount: number;
  aiChatCount: number;
  aiChatAbortedCount: number;
}

/** `1/1 次对话 · 1 取消`: cancellations are shown but never enter the denominator. */
export function formatAiChatHint(input: AiChatHintInput): string {
  return `${input.aiChatSuccessCount}/${input.aiChatCount} 次对话 · ${input.aiChatAbortedCount} 取消`;
}

/**
 * Category error counts that add up to the all-errors total, largest first.
 * Returns null when no category errored, so the card can omit its hint.
 */
export function formatErrorBreakdown(
  categoryCounts: readonly MonitorCategoryStats[],
): string | null {
  const errored = categoryCounts
    .filter((entry) => entry.errorCount > 0)
    .sort(
      (left, right) =>
        right.errorCount - left.errorCount ||
        left.category.localeCompare(right.category),
    );

  return errored.length === 0
    ? null
    : errored.map((entry) => `${entry.category} ${entry.errorCount}`).join(' · ');
}

export function shortenId(value: string, maxLength = 8): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}…`;
}

function compareLogs(left: AgentLog, right: AgentLog, sort: LogSort): number {
  if (sort.field === 'durationMs') {
    if (left.durationMs !== null && right.durationMs !== null) {
      const delta = left.durationMs - right.durationMs;

      if (delta !== 0) {
        return sort.direction === 'asc' ? delta : -delta;
      }
    } else if (left.durationMs === null && right.durationMs !== null) {
      return 1;
    } else if (right.durationMs === null && left.durationMs !== null) {
      return -1;
    }
  } else {
    const delta = left.timestamp - right.timestamp;

    if (delta !== 0) {
      return sort.direction === 'asc' ? delta : -delta;
    }
  }

  // Insertion ids increase with time, so the newest record wins a tie.
  return right.id - left.id;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

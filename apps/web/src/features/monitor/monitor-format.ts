import type { AgentLog, LogCategory, LogLevel } from '@paintcodex/protocol';

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

/** The live log buffer keeps at most this many records. */
export const MAX_LOG_BUFFER = 500;

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

  return sortLogs(Array.from(byId.values()), DEFAULT_LOG_SORT).slice(
    0,
    Math.max(1, Math.trunc(limit)),
  );
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

export function formatPercent(ratio: number): string {
  if (!Number.isFinite(ratio)) {
    return '—';
  }

  return `${(ratio * 100).toFixed(1)}%`;
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

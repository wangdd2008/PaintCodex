import type {
  AgentLog,
  AgentLogPage,
  AgentTrace,
  LogCategory,
  LogLevel,
  MonitorStats,
} from '@paintcodex/protocol';
import { ApiError } from '../../services/api';

export const DEFAULT_LOG_LIMIT = 50;

export const DEFAULT_STATS_WINDOW_MS = 300_000;

export type FilterValue<T extends string> = T | readonly T[] | null | undefined;

export interface LogQueryFilter {
  category?: FilterValue<LogCategory>;
  level?: FilterValue<LogLevel>;
  traceId?: string | null;
  canvasId?: string | null;
  since?: number | null;
  until?: number | null;
  limit?: number;
  offset?: number;
}

export interface LogStreamHandlers {
  onOpen?: () => void;
  onLog?: (log: AgentLog) => void;
  onError?: () => void;
}

interface MonitorErrorBody {
  error?: {
    code?: string;
    message?: string;
  };
}

/**
 * Serializes the monitor log filter into the daemon query format. Comma
 * separated categories and levels match the API's multi-value contract.
 */
export function buildLogsQuery(filter: LogQueryFilter = {}): string {
  const params: string[] = [];
  const categories = toValueList(filter.category);

  if (categories.length > 0) {
    params.push(`category=${categories.map(encodeURIComponent).join(',')}`);
  }

  const levels = toValueList(filter.level);

  if (levels.length > 0) {
    params.push(`level=${levels.map(encodeURIComponent).join(',')}`);
  }

  const traceId = toIdentifier(filter.traceId);

  if (traceId !== null) {
    params.push(`traceId=${encodeURIComponent(traceId)}`);
  }

  const canvasId = toIdentifier(filter.canvasId);

  if (canvasId !== null) {
    params.push(`canvasId=${encodeURIComponent(canvasId)}`);
  }

  if (isFinite(filter.since)) {
    params.push(`since=${Math.trunc(filter.since)}`);
  }

  if (isFinite(filter.until)) {
    params.push(`until=${Math.trunc(filter.until)}`);
  }

  params.push(`limit=${normalizeInteger(filter.limit, DEFAULT_LOG_LIMIT, 1)}`);
  params.push(`offset=${normalizeInteger(filter.offset, 0, 0)}`);

  return `?${params.join('&')}`;
}

export function fetchLogs(
  filter: LogQueryFilter = {},
  signal?: AbortSignal,
): Promise<AgentLogPage> {
  return request<AgentLogPage>(`/monitor/logs${buildLogsQuery(filter)}`, signal);
}

export function fetchTrace(traceId: string, signal?: AbortSignal): Promise<AgentTrace> {
  return request<AgentTrace>(`/monitor/traces/${encodeURIComponent(traceId)}`, signal);
}

export function fetchStats(
  windowMs: number = DEFAULT_STATS_WINDOW_MS,
  signal?: AbortSignal,
): Promise<MonitorStats> {
  const window = normalizeInteger(windowMs, DEFAULT_STATS_WINDOW_MS, 1);

  return request<MonitorStats>(`/monitor/stats?windowMs=${window}`, signal);
}

/**
 * Subscribes to the live log stream. EventSource reconnects on its own, so the
 * returned function only needs to close the connection when the page unmounts
 * or live tailing is paused.
 */
export function subscribeToLogs(handlers: LogStreamHandlers = {}): () => void {
  const source = new EventSource('/monitor/events');

  source.onopen = () => handlers.onOpen?.();

  source.addEventListener('log', (event) => {
    try {
      const payload = JSON.parse((event as MessageEvent<string>).data) as AgentLog;
      handlers.onLog?.(payload);
    } catch {
      // Ignore malformed frames; the stream stays usable.
    }
  });

  source.onerror = () => handlers.onError?.();

  return () => source.close();
}

async function request<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as MonitorErrorBody | null;

    throw new ApiError(
      body?.error?.message ?? `请求失败，状态码 ${response.status}`,
      response.status,
      body?.error?.code,
    );
  }

  return (await response.json()) as T;
}

function toValueList<T extends string>(value: FilterValue<T>): T[] {
  if (value === null || value === undefined) {
    return [];
  }

  const values = typeof value === 'string' ? [value] : [...value];

  return values.filter((item) => item.length > 0);
}

function toIdentifier(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function isFinite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(minimum, Math.trunc(value));
}

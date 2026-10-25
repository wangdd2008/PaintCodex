import type { Actor, LogCategory, LogLevel } from '@paintcodex/protocol';

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

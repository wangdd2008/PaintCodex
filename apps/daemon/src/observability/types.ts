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

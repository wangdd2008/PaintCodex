import type {
  Actor,
  AgentLog,
  AgentLogPage,
  LogCategory,
  LogComponent,
  LogLevel,
  MonitorStats,
} from '@paintcodex/protocol';
import { LOG_CATEGORIES } from '@paintcodex/protocol';
import type { DatabaseConnection } from '../storage/database.js';
import type {
  AgentLogQuery,
  AgentLogStatsOptions,
  NewAgentLogRecord,
} from './types.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;
const DEFAULT_WINDOW_MS = 5 * 60_000;
/** Below this many non-aborted chats a success rate is shown as unknown. */
const MIN_AI_CHAT_SAMPLE = 5;
/** Payload flag written by the AI chat route when the client cancels a chat. */
const ABORTED_FLAG = `COALESCE(json_extract(payload, '$.aborted'), 0)`;
/**
 * `/monitor/*` requests are logged so the log list keeps the evidence, but they
 * never reach an aggregate: the monitor must not measure its own polling.
 */
const EXCLUDE_MONITOR_HTTP = `NOT (
  category = 'http'
  AND COALESCE(json_extract(payload, '$.path'), '') LIKE '/monitor/%'
)`;

interface AgentLogRow {
  id: number;
  trace_id: string | null;
  span_id: string | null;
  parent_id: string | null;
  timestamp: number;
  level: LogLevel | null;
  category: LogCategory;
  message: string;
  payload: string | null;
  duration_ms: number | null;
  error: string | null;
  canvas_id: string | null;
  revision: number | null;
  actor: Actor | null;
  source: LogComponent | null;
  target: LogComponent | null;
}

const INSERT_SQL = `
  INSERT INTO agent_logs
    (trace_id, span_id, parent_id, timestamp, level, category, message, payload,
     duration_ms, error, canvas_id, revision, actor, source, target)
  VALUES
    (@traceId, @spanId, @parentId, @timestamp, @level, @category, @message, @payload,
     @durationMs, @error, @canvasId, @revision, @actor, @source, @target)
`;

/**
 * SQLite persistence for structured logs. Reads return parsed payloads and
 * camelCase fields so callers never deal with the storage layout.
 */
export class AgentLogRepository {
  constructor(private readonly db: DatabaseConnection) {}

  insert(record: NewAgentLogRecord): AgentLog {
    const result = this.db.prepare(INSERT_SQL).run({
      traceId: record.traceId ?? null,
      spanId: record.spanId ?? null,
      parentId: record.parentId ?? null,
      timestamp: record.timestamp ?? Date.now(),
      level: record.level ?? 'info',
      category: record.category,
      message: record.message,
      payload: serializePayload(record.payload),
      durationMs: record.durationMs ?? null,
      error: record.error ?? null,
      canvasId: record.canvasId ?? null,
      revision: record.revision ?? null,
      actor: record.actor ?? null,
      source: record.source ?? null,
      target: record.target ?? null,
    });

    const created = this.findById(Number(result.lastInsertRowid));

    if (!created) {
      throw new Error('Inserted agent log could not be read back');
    }

    return created;
  }

  findById(id: number): AgentLog | null {
    const row = this.db
      .prepare('SELECT * FROM agent_logs WHERE id = ?')
      .get(id) as AgentLogRow | undefined;

    return row ? mapRow(row) : null;
  }

  query(filter: AgentLogQuery = {}): AgentLogPage {
    const { where, params } = buildFilter(filter);
    const limit = clamp(filter.limit ?? DEFAULT_LIMIT, 1, MAX_LIMIT);
    const offset = Math.max(0, Math.trunc(filter.offset ?? 0));

    const totalRow = this.db
      .prepare(`SELECT COUNT(*) AS count FROM agent_logs ${where}`)
      .get(...params) as { count: number } | undefined;

    const rows = this.db
      .prepare(
        `SELECT * FROM agent_logs ${where}
         ORDER BY timestamp DESC, id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as AgentLogRow[];

    return {
      items: rows.map(mapRow),
      total: totalRow?.count ?? 0,
      limit,
      offset,
    };
  }

  findTrace(traceId: string): AgentLog[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM agent_logs
         WHERE trace_id = ?
         ORDER BY timestamp ASC, id ASC`,
      )
      .all(traceId) as AgentLogRow[];

    return rows.map(mapRow);
  }

  stats(options: AgentLogStatsOptions = {}): MonitorStats {
    const windowMs = Math.max(1, Math.trunc(options.windowMs ?? DEFAULT_WINDOW_MS));
    const since = (options.now ?? Date.now()) - windowMs;

    const categoryRows = this.db
      .prepare(
        `SELECT category,
                COUNT(*) AS count,
                SUM(CASE WHEN level = 'error' THEN 1 ELSE 0 END) AS error_count,
                SUM(CASE WHEN category = 'http' AND level = 'error'
                         THEN 1 ELSE 0 END) AS http_failure_count,
                SUM(CASE WHEN category = 'http' AND level = 'warn'
                         THEN 1 ELSE 0 END) AS http_conflict_count
         FROM agent_logs
         WHERE timestamp >= ? AND ${EXCLUDE_MONITOR_HTTP}
         GROUP BY category`,
      )
      .all(since) as Array<{
      category: LogCategory;
      count: number;
      error_count: number;
      http_failure_count: number;
      http_conflict_count: number;
    }>;

    const counts = new Map(
      categoryRows.map((row) => [row.category, row] as const),
    );
    const totalLogs = categoryRows.reduce((sum, row) => sum + row.count, 0);
    const errorCount = categoryRows.reduce(
      (sum, row) => sum + row.error_count,
      0,
    );
    const httpFailureCount = categoryRows.reduce(
      (sum, row) => sum + row.http_failure_count,
      0,
    );
    const httpConflictCount = categoryRows.reduce(
      (sum, row) => sum + row.http_conflict_count,
      0,
    );
    const requestCount = counts.get('http')?.count ?? 0;

    const durationRow = this.db
      .prepare(
        `SELECT AVG(duration_ms) AS average
         FROM agent_logs
         WHERE timestamp >= ? AND category = 'http' AND duration_ms IS NOT NULL
           AND ${EXCLUDE_MONITOR_HTTP}`,
      )
      .get(since) as { average: number | null } | undefined;

    const aiRow = this.db
      .prepare(
        `SELECT COUNT(*) AS count,
                SUM(CASE WHEN ${ABORTED_FLAG} = 1 THEN 1 ELSE 0 END) AS aborted,
                SUM(CASE WHEN level = 'info' AND ${ABORTED_FLAG} = 0
                         THEN 1 ELSE 0 END) AS success
         FROM agent_logs
         WHERE timestamp >= ? AND category = 'ai-chat' AND message = 'chat_completed'`,
      )
      .get(since) as
      | { count: number; aborted: number | null; success: number | null }
      | undefined;

    // Cancelling is a user decision, not an AI failure: aborted chats are
    // counted separately and never enter the success-rate denominator.
    const aiChatAbortedCount = aiRow?.aborted ?? 0;
    const aiChatCount = Math.max(0, (aiRow?.count ?? 0) - aiChatAbortedCount);
    const aiChatSuccessCount = aiRow?.success ?? 0;
    const aiChatSuccessRate =
      aiChatCount >= MIN_AI_CHAT_SAMPLE
        ? ratioOrNull(aiChatSuccessCount, aiChatCount)
        : null;

    return {
      windowMs,
      totalLogs,
      errorCount,
      errorRate: ratioOrNull(httpFailureCount + httpConflictCount, requestCount),
      requestCount,
      requestsPerSecond: round(requestCount / (windowMs / 1000)),
      avgDurationMs: round(durationRow?.average ?? 0),
      httpFailureCount,
      httpConflictCount,
      aiChatCount,
      aiChatSuccessCount,
      aiChatAbortedCount,
      aiChatSuccessRate,
      categoryCounts: LOG_CATEGORIES.map((category) => ({
        category,
        count: counts.get(category)?.count ?? 0,
        errorCount: counts.get(category)?.error_count ?? 0,
      })),
    };
  }
}

function buildFilter(filter: AgentLogQuery): {
  where: string;
  params: unknown[];
} {
  const clauses: string[] = [];
  const params: unknown[] = [];

  const categories = toArray(filter.category);

  if (categories.length > 0) {
    clauses.push(`category IN (${placeholders(categories.length)})`);
    params.push(...categories);
  }

  const levels = toArray(filter.level);

  if (levels.length > 0) {
    clauses.push(`level IN (${placeholders(levels.length)})`);
    params.push(...levels);
  }

  if (filter.traceId !== undefined) {
    clauses.push('trace_id = ?');
    params.push(filter.traceId);
  }

  if (filter.canvasId !== undefined) {
    clauses.push('canvas_id = ?');
    params.push(filter.canvasId);
  }

  if (filter.since !== undefined) {
    clauses.push('timestamp >= ?');
    params.push(filter.since);
  }

  if (filter.until !== undefined) {
    clauses.push('timestamp <= ?');
    params.push(filter.until);
  }

  return {
    where: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
  };
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

function serializePayload(payload: unknown): string | null {
  if (payload === undefined || payload === null) {
    return null;
  }

  try {
    return JSON.stringify(payload);
  } catch {
    return JSON.stringify(String(payload));
  }
}

function parsePayload(payload: string | null): unknown {
  if (payload === null) {
    return null;
  }

  try {
    return JSON.parse(payload);
  } catch {
    return payload;
  }
}

function mapRow(row: AgentLogRow): AgentLog {
  return {
    id: row.id,
    traceId: row.trace_id,
    spanId: row.span_id,
    parentId: row.parent_id,
    timestamp: row.timestamp,
    level: row.level ?? 'info',
    category: row.category,
    message: row.message,
    payload: parsePayload(row.payload),
    durationMs: row.duration_ms,
    error: row.error,
    canvasId: row.canvas_id,
    revision: row.revision,
    actor: row.actor,
    source: row.source,
    target: row.target,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/** Ratios with a zero denominator are unknown, not zero. */
function ratioOrNull(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : round(numerator / denominator);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

import type {
  Actor,
  AgentLog,
  AgentLogPage,
  LogCategory,
  LogComponent,
  LogLevel,
  MonitorStats,
  TopologySnapshot,
  TraceSummary,
  TraceSummaryPage,
} from '@paintcodex/protocol';
import { LOG_CATEGORIES, LOG_COMPONENTS } from '@paintcodex/protocol';
import type { DatabaseConnection } from '../storage/database.js';
import type {
  AgentLogQuery,
  AgentLogStatsOptions,
  NewAgentLogRecord,
  TopologyOptions,
  TraceSummaryOptions,
} from './types.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;
const DEFAULT_WINDOW_MS = 5 * 60_000;
/** 追踪摘要默认窗口 15 分钟；上限 24 小时（路由层校验范围）。 */
const DEFAULT_TRACE_WINDOW_MS = 15 * 60_000;
/** 拓扑快照默认窗口 5 分钟；与统计卡片同口径（票 ③06）。 */
const DEFAULT_TOPOLOGY_WINDOW_MS = 5 * 60_000;
const DEFAULT_TRACE_LIMIT = 50;
const MAX_TRACE_LIMIT = 100;
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

/** `GROUP BY trace_id` 的聚合行：只装核心计数，代表行字段在内存里归并。 */
interface TraceAggregateRow {
  trace_id: string;
  started_at: number;
  ended_at: number;
  span_count: number;
  error_count: number;
}

/** 摘要归并用的明细行：按 (trace_id, timestamp, id) 有序读出。 */
interface TraceDetailRow {
  trace_id: string;
  timestamp: number;
  id: number;
  parent_id: string | null;
  category: LogCategory;
  message: string;
  payload: string | null;
  canvas_id: string | null;
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

    // 逐条视图按落库顺序（id DESC）：span 完成记录回溯写入开始时间，
    // 按 timestamp 排会让完成记录「排在开始记录上面」（monitor-readability ③04）。
    const rows = this.db
      .prepare(
        `SELECT * FROM agent_logs ${where}
         ORDER BY id DESC
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

  /**
   * 窗口内按 trace_id 聚合的一行一个追踪（monitor-readability ③03）。
   *
   * 起止/节点数/错误数由一条 GROUP BY SQL 算出来；`components`、`rootMessage`、
   * `requestPath` 这类「取一条代表行」的字段，用第二句话把本页 ≤100 个追踪的
   * 明细行拉回内存按时间顺序归并——既走 `(trace_id, timestamp)` 索引，又避开
   * 在聚合 SQL 里写一堆相关子查询。
   */
  summarizeTraces(options: TraceSummaryOptions = {}): TraceSummaryPage {
    const windowMs = Math.max(1, Math.trunc(options.windowMs ?? DEFAULT_TRACE_WINDOW_MS));
    const since = (options.now ?? Date.now()) - windowMs;
    const limit = clamp(options.limit ?? DEFAULT_TRACE_LIMIT, 1, MAX_TRACE_LIMIT);
    const offset = Math.max(0, Math.trunc(options.offset ?? 0));

    const whereParams: unknown[] = [since];
    // 窗口是硬约束：先把行限制在 `timestamp >= since` 内再 GROUP BY，
    // 否则全表分组会随日志无界增长变慢（ADR-0012）。
    let where = 'timestamp >= ? AND trace_id IS NOT NULL';

    // canvasId 下钻：只保留窗口内触碰过该画布的追踪，但聚合仍算该追踪的全部窗口内行。
    if (options.canvasId !== undefined) {
      where += ` AND trace_id IN (
        SELECT trace_id FROM agent_logs
        WHERE canvas_id = ? AND timestamp >= ? AND trace_id IS NOT NULL
      )`;
      whereParams.push(options.canvasId, since);
    }

    const having = options.hasError
      ? " HAVING SUM(CASE WHEN level = 'error' THEN 1 ELSE 0 END) > 0"
      : '';

    // 一次分组取回窗口内全部追踪的聚合值（窗口内 trace 数有限，几十到几千），
    // total 与分页都在内存里切片——避免为 COUNT 再扫一遍 10 万行。
    const rows = this.db
      .prepare(
        `SELECT trace_id,
                MIN(timestamp) AS started_at,
                MAX(timestamp + COALESCE(duration_ms, 0)) AS ended_at,
                COUNT(*) AS span_count,
                SUM(CASE WHEN level = 'error' THEN 1 ELSE 0 END) AS error_count
         FROM agent_logs
         WHERE ${where}
         GROUP BY trace_id
         ${having}
         ORDER BY started_at DESC, trace_id ASC`,
      )
      .all(...whereParams) as TraceAggregateRow[];

    const items = this.enrichTraceSummaries(rows.slice(offset, offset + limit), since);

    return {
      items,
      total: rows.length,
      windowMs,
    };
  }

  /**
   * 把本页追踪的明细行按 trace_id 拉回内存，归并出 components（去重、按首次出现
   * 排序）、根消息、根 http 路径、画布与操作者。明细行按 (trace_id, timestamp, id)
   * 有序返回，归并是线性的。
   */
  private enrichTraceSummaries(
    aggregates: TraceAggregateRow[],
    since: number,
  ): TraceSummary[] {
    if (aggregates.length === 0) {
      return [];
    }

    const byTrace = new Map<string, TraceSummary>();

    for (const row of aggregates) {
      byTrace.set(row.trace_id, {
        traceId: row.trace_id,
        startedAt: row.started_at,
        endedAt: row.ended_at,
        spanCount: row.span_count,
        errorCount: row.error_count,
        components: [],
        rootMessage: '',
        requestPath: null,
        canvasId: null,
        actor: null,
      });
    }

    const placeholders = aggregates.map(() => '?').join(', ');
    const detailRows = this.db
      .prepare(
        `SELECT trace_id, timestamp, id, parent_id, category, message,
                payload, canvas_id, actor, source, target
         FROM agent_logs
         WHERE trace_id IN (${placeholders}) AND timestamp >= ?
         ORDER BY trace_id ASC, timestamp ASC, id ASC`,
      )
      .all(...aggregates.map((row) => row.trace_id), since) as TraceDetailRow[];

    // 同一追踪的明细行已按时间排好，逐行归并即可得到「首次出现」顺序。
    const seenComponents = new Map<string, Set<LogComponent>>();
    const firstHttpPath = new Map<string, string | null>();

    for (const row of detailRows) {
      const summary = byTrace.get(row.trace_id);

      if (!summary) {
        continue;
      }

      // components 取 source∪target（与前端 buildSequence 同口径）：daemon→sqlite
      // 的落库记录里 sqlite 只出现在 target 端，单取 source 会漏掉它，
      // 进而让追踪列表的「组件路径」与拓扑 SQLite chip 恒空。
      // 同一行内先记 source 再记 target，与时序图列顺序一致。
      for (const component of [row.source, row.target]) {
        if (component === null) {
          continue;
        }

        let seen = seenComponents.get(row.trace_id);

        if (!seen) {
          seen = new Set();
          seenComponents.set(row.trace_id, seen);
        }

        if (!seen.has(component)) {
          seen.add(component);
          summary.components.push(component);
        }
      }

      // 根 span：无父记录的那条；整段都没有无父记录时，最早一条即根。
      if (summary.rootMessage === '' && row.parent_id === null) {
        summary.rootMessage = row.message;
        summary.canvasId = row.canvas_id;
        summary.actor = row.actor;
      }

      // 兜底：根记录本身没有画布/操作者时，取本追踪首个非空值。
      if (summary.canvasId === null && row.canvas_id !== null) {
        summary.canvasId = row.canvas_id;
      }

      if (summary.actor === null && row.actor !== null) {
        summary.actor = row.actor;
      }

      if (row.category === 'http' && !firstHttpPath.has(row.trace_id)) {
        firstHttpPath.set(row.trace_id, httpPathOf(row.payload));
      }
    }

    // 根记录缺失（整段都是孤儿行）时，最早一条 message 就是根消息。
    for (const row of detailRows) {
      const summary = byTrace.get(row.trace_id);

      if (summary && summary.rootMessage === '') {
        summary.rootMessage = row.message;
      }
    }

    for (const summary of byTrace.values()) {
      const path = firstHttpPath.get(summary.traceId);

      if (path !== undefined) {
        summary.requestPath = path;
      }
    }

    return aggregates.map((row) => byTrace.get(row.trace_id)!);
  }

  /**
   * 拓扑快照（monitor-readability ③06）：窗口内按方向记录聚合出节点与有向通道。
   *
   * 节点计数 = source 或 target 为该组件的记录数（发出与接收都触碰它）；
   * 通道计数 = 同一条 (source, target) 记录数。平均耗时只纳入
   * `durationMs <= 10_000` 的记录——SSE 长连接会把均值拉到几分钟（ADR-0012）。
   * nodes 恒为全部五个组件，无流量为 0，静态拓扑不因缺数据变形。
   */
  summarizeTopology(options: TopologyOptions = {}): TopologySnapshot {
    const windowMs = Math.max(1, Math.trunc(options.windowMs ?? DEFAULT_TOPOLOGY_WINDOW_MS));
    const since = (options.now ?? Date.now()) - windowMs;

    const touched = new Map<LogComponent, { count: number; errorCount: number }>();

    for (const component of LOG_COMPONENTS) {
      touched.set(component, { count: 0, errorCount: 0 });
    }

    // 节点触碰拆成 source / target 两条 GROUP BY：避免一次 GROUP BY (source,target)
    // 再 UNION 带来的重复行，且两条都走 source/target 索引前缀。
    for (const column of ['source', 'target'] as const) {
      const rows = this.db
        .prepare(
          `SELECT ${column} AS component,
                  COUNT(*) AS count,
                  SUM(CASE WHEN level = 'error' THEN 1 ELSE 0 END) AS error_count
           FROM agent_logs
           WHERE timestamp >= ? AND ${column} IS NOT NULL AND ${EXCLUDE_MONITOR_HTTP}
           GROUP BY ${column}`,
        )
        .all(since) as Array<{
        component: LogComponent;
        count: number;
        error_count: number;
      }>;

      for (const row of rows) {
        const bucket = touched.get(row.component);

        if (bucket) {
          bucket.count += row.count;
          bucket.errorCount += row.error_count;
        }
      }
    }

    const edgeRows = this.db
      .prepare(
        `SELECT source,
                target,
                COUNT(*) AS count,
                SUM(CASE WHEN level = 'error' THEN 1 ELSE 0 END) AS error_count,
                AVG(CASE WHEN duration_ms IS NOT NULL AND duration_ms <= 10000
                         THEN duration_ms END) AS avg_duration
         FROM agent_logs
         WHERE timestamp >= ? AND source IS NOT NULL AND target IS NOT NULL
           AND ${EXCLUDE_MONITOR_HTTP}
         GROUP BY source, target
         ORDER BY source, target`,
      )
      .all(since) as Array<{
      source: LogComponent;
      target: LogComponent;
      count: number;
      error_count: number;
      avg_duration: number | null;
    }>;

    return {
      windowMs,
      nodes: LOG_COMPONENTS.map((id) => ({
        id,
        count: touched.get(id)?.count ?? 0,
        errorCount: touched.get(id)?.errorCount ?? 0,
      })),
      edges: edgeRows.map((row) => ({
        source: row.source,
        target: row.target,
        count: row.count,
        errorCount: row.error_count,
        avgDurationMs: row.avg_duration === null ? null : round(row.avg_duration),
      })),
    };
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

/** 根 http span 的请求路径；payload 里没有 `path` 或不是对象时返回 null。 */
function httpPathOf(payload: string | null): string | null {
  const parsed = parsePayload(payload);

  if (parsed !== null && typeof parsed === 'object' && 'path' in parsed) {
    const path = (parsed as { path?: unknown }).path;

    if (typeof path === 'string') {
      return path;
    }
  }

  return null;
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

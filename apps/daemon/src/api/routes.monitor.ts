import type { ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';
import type {
  AgentLog,
  AgentTraceNode,
  LogCategory,
  LogLevel,
} from '@paintcodex/protocol';
import { LOG_CATEGORIES, LOG_LEVELS } from '@paintcodex/protocol';
import type { Observability } from '../observability/index.js';
import type { AgentLogQuery } from '../observability/types.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;
const DEFAULT_WINDOW_MS = 300_000;
const MAX_WINDOW_MS = 86_400_000;
const HEARTBEAT_MS = 15_000;

type QueryValues = Record<string, unknown>;

type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

/**
 * Monitor API consumed by the web monitoring page: paginated log queries,
 * trace trees, aggregate stats and a live SSE stream.
 *
 * None of these routes log anything themselves. The SSE stream in particular
 * must stay silent, otherwise every push would create another push.
 */
export function registerMonitorRoutes(
  app: FastifyInstance,
  observability: Observability,
): void {
  app.get('/monitor/logs', async (request, reply) => {
    const query = parseLogsQuery(asQuery(request.query));

    if (!query.ok) {
      return reply.code(400).send(invalidQuery(query.message));
    }

    return observability.repository.query(query.value);
  });

  app.get<{ Params: { traceId: string } }>(
    '/monitor/traces/:traceId',
    async (request, reply) => {
      const logs = observability.repository.findTrace(request.params.traceId);

      if (logs.length === 0) {
        return reply.code(404).send({
          error: { code: 'trace_not_found', message: '追踪不存在' },
        });
      }

      return {
        traceId: request.params.traceId,
        roots: buildTraceTree(logs),
      };
    },
  );

  app.get('/monitor/stats', async (request, reply) => {
    const windowMs = parseOptionalInteger(
      asQuery(request.query).windowMs,
      'windowMs',
      1,
      MAX_WINDOW_MS,
    );

    if (!windowMs.ok) {
      return reply.code(400).send(invalidQuery(windowMs.message));
    }

    return observability.repository.stats({
      windowMs: windowMs.value ?? DEFAULT_WINDOW_MS,
    });
  });

  app.get('/monitor/events', async (request, reply) => {
    reply.hijack();

    const stream = reply.raw;
    stream.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Acknowledge before subscribing so the client never waits on a listener
    // that was installed before the stream became writable.
    writeChunk(stream, ': connected\n\n');

    const unsubscribe = observability.events.subscribe((log) => {
      writeChunk(stream, `event: log\ndata: ${JSON.stringify(log)}\n\n`);
    });

    const heartbeat = setInterval(() => {
      writeChunk(stream, ': ping\n\n');
    }, HEARTBEAT_MS);

    request.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
}

/**
 * Monitor streaming must never log: a record about this stream would be
 * published back into the same stream, creating an endless feedback loop.
 */
function writeChunk(stream: ServerResponse, chunk: string): void {
  if (stream.writableEnded || stream.destroyed) {
    return;
  }

  try {
    stream.write(chunk);
  } catch {
    // The client is gone; teardown happens through the close handler.
  }
}

/** A tree node plus mutable linkage used only while the tree is assembled. */
interface MutableTraceNode extends AgentTraceNode {
  children: MutableTraceNode[];
}

/**
 * Two passes: index every node by span id, then attach each record to the
 * record whose span id matches its `parentId`. Missing parents and cycles
 * become roots so the result is always a finite forest.
 */
function buildTraceTree(logs: AgentLog[]): AgentTraceNode[] {
  const ordered = [...logs].sort(compareLogs);
  const nodes: MutableTraceNode[] = ordered.map((log) => ({ log, children: [] }));
  const bySpanId = new Map<string, MutableTraceNode>();

  for (const node of nodes) {
    const spanId = node.log.spanId;

    if (spanId !== null && !bySpanId.has(spanId)) {
      bySpanId.set(spanId, node);
    }
  }

  const parentOf = new Map<MutableTraceNode, MutableTraceNode>();

  for (const node of nodes) {
    const parentId = node.log.parentId;

    if (parentId === null) {
      continue;
    }

    const parent = bySpanId.get(parentId);

    // A self reference is a cycle of length one; leave it as a root.
    if (parent !== undefined && parent !== node) {
      parentOf.set(node, parent);
    }
  }

  breakParentCycles(nodes, parentOf);

  const roots: MutableTraceNode[] = [];

  for (const node of nodes) {
    const parent = parentOf.get(node);

    if (parent === undefined) {
      roots.push(node);
    } else {
      parent.children.push(node);
    }
  }

  // Nodes were visited in timestamp/id order, so roots and children are too.
  return roots;
}

/**
 * Walks parent chains iteratively and detaches the entry node of every cycle.
 * Marking visited nodes keeps this linear even for long chains.
 */
function breakParentCycles(
  nodes: MutableTraceNode[],
  parentOf: Map<MutableTraceNode, MutableTraceNode>,
): void {
  const resolved = new Set<MutableTraceNode>();

  for (const start of nodes) {
    if (resolved.has(start)) {
      continue;
    }

    const path: MutableTraceNode[] = [];
    const seen = new Set<MutableTraceNode>();
    let current: MutableTraceNode | undefined = start;

    while (current !== undefined && !resolved.has(current)) {
      if (seen.has(current)) {
        parentOf.delete(current);
        break;
      }

      seen.add(current);
      path.push(current);
      current = parentOf.get(current);
    }

    for (const node of path) {
      resolved.add(node);
    }
  }
}

function compareLogs(a: AgentLog, b: AgentLog): number {
  return a.timestamp - b.timestamp || a.id - b.id;
}

function parseLogsQuery(query: QueryValues): Parsed<AgentLogQuery> {
  const categories = parseEnumList<LogCategory>(
    query.category,
    LOG_CATEGORIES,
    'category',
  );

  if (!categories.ok) {
    return categories;
  }

  const levels = parseEnumList<LogLevel>(query.level, LOG_LEVELS, 'level');

  if (!levels.ok) {
    return levels;
  }

  const traceId = parseOptionalString(query.traceId, 'traceId');

  if (!traceId.ok) {
    return traceId;
  }

  const canvasId = parseOptionalString(query.canvasId, 'canvasId');

  if (!canvasId.ok) {
    return canvasId;
  }

  const since = parseOptionalInteger(query.since, 'since');

  if (!since.ok) {
    return since;
  }

  const until = parseOptionalInteger(query.until, 'until');

  if (!until.ok) {
    return until;
  }

  const limit = parseOptionalInteger(query.limit, 'limit', 1, MAX_LIMIT);

  if (!limit.ok) {
    return limit;
  }

  const offset = parseOptionalInteger(query.offset, 'offset', 0);

  if (!offset.ok) {
    return offset;
  }

  return {
    ok: true,
    value: {
      category: categories.value,
      level: levels.value,
      traceId: traceId.value,
      canvasId: canvasId.value,
      since: since.value,
      until: until.value,
      limit: limit.value ?? DEFAULT_LIMIT,
      offset: offset.value ?? 0,
    },
  };
}

function asQuery(value: unknown): QueryValues {
  return typeof value === 'object' && value !== null
    ? (value as QueryValues)
    : {};
}

/**
 * Comma-separated multi-value filter. Values must match the protocol union
 * exactly; unknown values are a client error rather than an empty result.
 */
function parseEnumList<T extends string>(
  value: unknown,
  allowed: readonly T[],
  name: string,
): Parsed<T[] | undefined> {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }

  if (typeof value !== 'string') {
    return { ok: false, message: `${name} 必须是逗号分隔的值` };
  }

  const items = value.split(',').map((item) => item.trim());
  const invalid = items.find((item) => !(allowed as readonly string[]).includes(item));

  if (invalid !== undefined) {
    return {
      ok: false,
      message: `未知的 ${name}: ${invalid === '' ? '(空)' : invalid}`,
    };
  }

  return { ok: true, value: items as T[] };
}

function parseOptionalString(value: unknown, name: string): Parsed<string | undefined> {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }

  if (typeof value !== 'string') {
    return { ok: false, message: `${name} 必须是字符串` };
  }

  return { ok: true, value };
}

function parseOptionalInteger(
  value: unknown,
  name: string,
  min = Number.MIN_SAFE_INTEGER,
  max = Number.MAX_SAFE_INTEGER,
): Parsed<number | undefined> {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }

  const parsed = toInteger(value);

  if (parsed === null) {
    return { ok: false, message: `${name} 必须是整数` };
  }

  if (parsed < min || parsed > max) {
    return {
      ok: false,
      message:
        max === Number.MAX_SAFE_INTEGER
          ? `${name} 必须是大于等于 ${min} 的整数`
          : `${name} 必须是 ${min} 到 ${max} 之间的整数`,
    };
  }

  return { ok: true, value: parsed };
}

function toInteger(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) ? value : null;
  }

  if (typeof value !== 'string' || !/^-?\d+$/.test(value)) {
    return null;
  }

  const parsed = Number(value);

  return Number.isSafeInteger(parsed) ? parsed : null;
}

function invalidQuery(message: string): {
  error: { code: 'invalid_query'; message: string };
} {
  return { error: { code: 'invalid_query', message } };
}

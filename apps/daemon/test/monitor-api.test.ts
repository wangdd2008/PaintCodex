import { request as httpRequest } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AgentLog, AgentTrace, AgentTraceNode, MonitorStats } from '@paintcodex/protocol';
import { LOG_CATEGORIES, LOG_LEVELS } from '@paintcodex/protocol';
import type { NewAgentLogRecord } from '../src/observability/types.js';
import { buildServer } from '../src/api/server.js';

const openApps: FastifyInstance[] = [];

function createApp(): FastifyInstance {
  const app = buildServer({ dbPath: ':memory:' });
  openApps.push(app);

  return app;
}

function seed(app: FastifyInstance, record: NewAgentLogRecord): void {
  app.observability.log(record);
}

/** Depth-first flatten that tolerates any tree shape the API returns. */
function flattenTrace(nodes: AgentTraceNode[]): AgentTraceNode[] {
  const collected: AgentTraceNode[] = [];
  const stack = [...nodes];

  while (stack.length > 0) {
    const node = stack.pop();

    if (!node) {
      continue;
    }

    collected.push(node);
    stack.push(...node.children);
  }

  return collected;
}

interface SseClient {
  ready: Promise<void>;
  text: () => string;
  waitFor: (predicate: (text: string) => boolean) => Promise<string>;
  close: () => void;
}

function connectSse(url: string): SseClient {
  let buffer = '';
  let resolveReady: (() => void) | null = null;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  const waiters: Array<{
    predicate: (text: string) => boolean;
    resolve: (text: string) => void;
  }> = [];

  const request = httpRequest(url, (response) => {
    response.setEncoding('utf8');
    response.on('data', (chunk: string) => {
      buffer += chunk;

      if (buffer.includes(': connected')) {
        resolveReady?.();
        resolveReady = null;
      }

      for (const waiter of [...waiters]) {
        if (waiter.predicate(buffer)) {
          waiters.splice(waiters.indexOf(waiter), 1);
          waiter.resolve(buffer);
        }
      }
    });
  });

  request.on('error', () => undefined);
  request.end();

  return {
    ready,
    text: () => buffer,
    waitFor: (predicate) =>
      new Promise((resolve, reject) => {
        if (predicate(buffer)) {
          resolve(buffer);
          return;
        }

        const waiter = {
          predicate,
          resolve: (text: string) => {
            clearTimeout(timer);
            resolve(text);
          },
        };

        const timer = setTimeout(() => {
          const index = waiters.indexOf(waiter);

          if (index >= 0) {
            waiters.splice(index, 1);
          }

          reject(new Error(`SSE timeout. Received: ${buffer}`));
        }, 4000);

        waiters.push(waiter);
      }),
    close: () => request.destroy(),
  };
}

function logEvent(text: string): AgentLog | null {
  const line = text
    .split('\n')
    .filter((value) => value.startsWith('data: '))
    .at(-1);

  if (!line) {
    return null;
  }

  return JSON.parse(line.slice('data: '.length)) as AgentLog;
}

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

describe('GET /monitor/logs', () => {
  it('paginates newest-first and reports the unpaged total', async () => {
    const app = createApp();
    seed(app, { category: 'system', message: 'first', timestamp: 1_000 });
    seed(app, { category: 'system', message: 'second', timestamp: 2_000 });
    seed(app, { category: 'system', message: 'third', timestamp: 3_000 });

    const page = await app.inject({
      method: 'GET',
      url: '/monitor/logs?category=system&limit=2',
    });

    expect(page.statusCode).toBe(200);
    expect(page.json()).toMatchObject({
      total: 3,
      limit: 2,
      offset: 0,
      items: [{ message: 'third' }, { message: 'second' }],
    });

    const next = await app.inject({
      method: 'GET',
      url: '/monitor/logs?category=system&limit=2&offset=2',
    });

    expect(next.json()).toMatchObject({
      total: 3,
      limit: 2,
      offset: 2,
      items: [{ message: 'first' }],
    });
  });

  it('applies the default limit of 50', async () => {
    const app = createApp();
    seed(app, { category: 'system', message: 'only', timestamp: 1_000 });

    const response = await app.inject({
      method: 'GET',
      url: '/monitor/logs?category=system',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ total: 1, limit: 50, offset: 0 });
  });

  it('filters by one or more categories', async () => {
    const app = createApp();
    seed(app, { category: 'canvas-action', message: 'layer_created', timestamp: 1_000 });
    seed(app, { category: 'ai-chat', message: 'chat_completed', timestamp: 2_000 });
    seed(app, { category: 'system', message: 'startup', timestamp: 3_000 });

    const response = await app.inject({
      method: 'GET',
      url: '/monitor/logs?category=canvas-action,ai-chat',
    });

    expect(response.statusCode).toBe(200);

    const body = response.json() as { total: number; items: Array<{ category: string }> };

    expect(body.total).toBe(2);
    expect(body.items.map((item) => item.category).sort()).toEqual([
      'ai-chat',
      'canvas-action',
    ]);
  });

  it('filters by one or more levels', async () => {
    const app = createApp();
    seed(app, { category: 'system', level: 'info', message: 'info', timestamp: 1_000 });
    seed(app, { category: 'system', level: 'warn', message: 'warn', timestamp: 2_000 });
    seed(app, { category: 'system', level: 'error', message: 'error', timestamp: 3_000 });

    const response = await app.inject({
      method: 'GET',
      url: '/monitor/logs?category=system&level=warn,error',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      total: 2,
      items: [{ message: 'error' }, { message: 'warn' }],
    });
  });

  it('filters by inclusive time range', async () => {
    const app = createApp();
    seed(app, { category: 'system', message: 'before', timestamp: 1_000 });
    seed(app, { category: 'system', message: 'inside', timestamp: 2_000 });
    seed(app, { category: 'system', message: 'after', timestamp: 3_000 });

    const response = await app.inject({
      method: 'GET',
      url: '/monitor/logs?category=system&since=2000&until=2000',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      total: 1,
      items: [{ message: 'inside' }],
    });
  });

  it('filters by traceId', async () => {
    const app = createApp();
    seed(app, {
      category: 'ai-chat',
      message: 'chat_completed',
      timestamp: 1_000,
      traceId: 'trace-a',
      spanId: 'span-a',
    });
    seed(app, {
      category: 'ai-chat',
      message: 'chat_completed',
      timestamp: 2_000,
      traceId: 'trace-b',
      spanId: 'span-b',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/monitor/logs?traceId=trace-a',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      total: 1,
      items: [{ traceId: 'trace-a', message: 'chat_completed' }],
    });
  });

  it('returns 400 invalid_query for unsupported filters and pagination', async () => {
    const app = createApp();

    const urls = [
      '/monitor/logs?category=bogus',
      '/monitor/logs?category=system,bogus',
      '/monitor/logs?level=loud',
      '/monitor/logs?level=info,loud',
      '/monitor/logs?limit=0',
      '/monitor/logs?limit=501',
      '/monitor/logs?limit=abc',
      '/monitor/logs?limit=2.5',
      '/monitor/logs?offset=-1',
      '/monitor/logs?offset=1.5',
      '/monitor/logs?since=abc',
      '/monitor/logs?until=1.5',
    ];

    for (const url of urls) {
      const response = await app.inject({ method: 'GET', url });

      expect(response.statusCode, url).toBe(400);
      expect(response.json(), url).toMatchObject({
        error: { code: 'invalid_query' },
      });
    }
  });

  it('accepts every declared category and level value', async () => {
    expect(LOG_CATEGORIES.length).toBeGreaterThan(0);
    expect(LOG_LEVELS.length).toBeGreaterThan(0);

    const app = createApp();

    const categories = await app.inject({
      method: 'GET',
      url: `/monitor/logs?category=${LOG_CATEGORIES.join(',')}`,
    });
    const levels = await app.inject({
      method: 'GET',
      url: `/monitor/logs?level=${LOG_LEVELS.join(',')}`,
    });

    expect(categories.statusCode).toBe(200);
    expect(levels.statusCode).toBe(200);
  });
});

describe('GET /monitor/traces/:traceId', () => {
  it('returns the spans of a trace as a parent/child tree', async () => {
    const app = createApp();
    const root = app.observability.startTrace({
      category: 'ai-chat',
      message: 'ai_chat',
      payload: { hasCanvas: false },
    });
    const child = root.startSpan({
      category: 'ai-chat',
      message: 'codex_exec',
    });
    const event = root.log({ message: 'prompt_built' });

    child.finish();
    root.finish();

    const response = await app.inject({
      method: 'GET',
      url: `/monitor/traces/${root.traceId}`,
    });

    expect(response.statusCode).toBe(200);

    const trace = response.json() as AgentTrace;

    expect(trace.traceId).toBe(root.traceId);
    expect(trace.roots).toHaveLength(1);

    const rootNode = trace.roots[0];

    if (!rootNode) {
      throw new Error('expected one root node');
    }

    expect(rootNode.log).toMatchObject({
      traceId: root.traceId,
      spanId: root.spanId,
      message: 'ai_chat',
    });
    expect(rootNode.children.map((node) => node.log.message)).toEqual(
      expect.arrayContaining(['prompt_built', 'codex_exec']),
    );

    const promptNode = rootNode.children.find(
      (node) => node.log.id === event.id,
    );
    const codexNode = rootNode.children.find(
      (node) => node.log.spanId === child.spanId,
    );

    expect(promptNode?.log.parentId).toBe(root.spanId);
    expect(codexNode?.log.parentId).toBe(root.spanId);
    expect(codexNode?.children).toEqual([]);
  });

  it('orders roots and children by timestamp then id', async () => {
    const app = createApp();
    const traceId = 'trace-ordered';

    seed(app, {
      traceId,
      spanId: 'root-a',
      message: 'root-a',
      category: 'system',
      timestamp: 3_000,
    });
    seed(app, {
      traceId,
      spanId: 'child-late-1',
      parentId: 'root-a',
      message: 'child-late-1',
      category: 'system',
      timestamp: 5_000,
    });
    seed(app, {
      traceId,
      spanId: 'child-late-2',
      parentId: 'root-a',
      message: 'child-late-2',
      category: 'system',
      timestamp: 5_000,
    });
    seed(app, {
      traceId,
      spanId: 'child-early',
      parentId: 'root-a',
      message: 'child-early',
      category: 'system',
      timestamp: 4_000,
    });
    seed(app, {
      traceId,
      spanId: 'grandchild',
      parentId: 'child-early',
      message: 'grandchild',
      category: 'system',
      timestamp: 1_000,
    });
    seed(app, {
      traceId,
      spanId: 'root-b',
      message: 'root-b',
      category: 'system',
      timestamp: 2_000,
    });

    const response = await app.inject({
      method: 'GET',
      url: `/monitor/traces/${traceId}`,
    });

    expect(response.statusCode).toBe(200);

    const trace = response.json() as AgentTrace;

    expect(trace.roots.map((node) => node.log.message)).toEqual([
      'root-b',
      'root-a',
    ]);

    const rootA = trace.roots[1];

    if (!rootA) {
      throw new Error('expected root-a');
    }

    expect(rootA.children.map((node) => node.log.message)).toEqual([
      'child-early',
      'child-late-1',
      'child-late-2',
    ]);
    expect(rootA.children[0]?.children.map((node) => node.log.message)).toEqual([
      'grandchild',
    ]);
  });

  it('treats a span with a missing parent as a root', async () => {
    const app = createApp();
    seed(app, {
      traceId: 'trace-orphan',
      spanId: 'orphan',
      parentId: 'does-not-exist',
      message: 'orphan',
      category: 'system',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/monitor/traces/trace-orphan',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      traceId: 'trace-orphan',
      roots: [{ log: { message: 'orphan' }, children: [] }],
    });
  });

  it('breaks reference cycles instead of recursing forever', async () => {
    const app = createApp();
    seed(app, {
      traceId: 'trace-cycle',
      spanId: 'a',
      parentId: 'b',
      message: 'a',
      category: 'system',
      timestamp: 1_000,
    });
    seed(app, {
      traceId: 'trace-cycle',
      spanId: 'b',
      parentId: 'a',
      message: 'b',
      category: 'system',
      timestamp: 2_000,
    });
    seed(app, {
      traceId: 'trace-cycle',
      spanId: 'self',
      parentId: 'self',
      message: 'self',
      category: 'system',
      timestamp: 3_000,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/monitor/traces/trace-cycle',
    });

    expect(response.statusCode).toBe(200);

    const trace = response.json() as AgentTrace;
    const nodes = flattenTrace(trace.roots);

    expect(nodes).toHaveLength(3);
    expect(nodes.map((node) => node.log.message).sort()).toEqual([
      'a',
      'b',
      'self',
    ]);
  });

  it('returns 404 trace_not_found for an unknown trace', async () => {
    const app = createApp();

    const response = await app.inject({
      method: 'GET',
      url: '/monitor/traces/missing',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: 'trace_not_found', message: 'Trace not found' },
    });
  });
});

describe('GET /monitor/stats', () => {
  it('aggregates the default window by category, errors, duration and AI results', async () => {
    const app = createApp();
    const now = Date.now();

    seed(app, {
      category: 'http',
      message: 'http_request',
      durationMs: 120,
      timestamp: now,
    });
    seed(app, {
      category: 'http',
      message: 'http_request',
      level: 'error',
      durationMs: 80,
      timestamp: now,
    });
    seed(app, {
      category: 'ai-chat',
      message: 'chat_completed',
      level: 'info',
      timestamp: now,
    });
    seed(app, {
      category: 'ai-chat',
      message: 'chat_completed',
      level: 'error',
      error: 'codex exited',
      timestamp: now,
    });
    seed(app, {
      category: 'system',
      message: 'startup',
      timestamp: now - 10 * 60_000,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/monitor/stats',
    });

    expect(response.statusCode).toBe(200);

    const stats = response.json() as MonitorStats;

    expect(stats.windowMs).toBe(300_000);
    expect(stats.totalLogs).toBe(4);
    expect(stats.errorCount).toBe(2);
    expect(stats.errorRate).toBe(0.5);
    expect(stats.requestCount).toBe(2);
    expect(stats.requestsPerSecond).toBe(0.007);
    expect(stats.avgDurationMs).toBe(100);
    expect(stats.aiChatCount).toBe(2);
    expect(stats.aiChatSuccessCount).toBe(1);
    expect(stats.aiChatSuccessRate).toBe(0.5);
    expect(stats.categoryCounts).toHaveLength(LOG_CATEGORIES.length);
    expect(stats.categoryCounts).toEqual(
      expect.arrayContaining([
        { category: 'http', count: 2, errorCount: 1 },
        { category: 'ai-chat', count: 2, errorCount: 1 },
        { category: 'system', count: 0, errorCount: 0 },
      ]),
    );
  });

  it('honours an explicit windowMs covering older records', async () => {
    const now = Date.now();
    const old = {
      category: 'system' as const,
      message: 'old',
      timestamp: now - 10 * 60_000,
    };

    // Separate apps keep each request's own http log out of the other window.
    const narrowApp = createApp();
    seed(narrowApp, old);
    const narrow = await narrowApp.inject({
      method: 'GET',
      url: '/monitor/stats',
    });

    const wideApp = createApp();
    seed(wideApp, old);
    const wide = await wideApp.inject({
      method: 'GET',
      url: '/monitor/stats?windowMs=3600000',
    });

    expect(narrow.json()).toMatchObject({ windowMs: 300_000, totalLogs: 0 });
    expect(wide.json()).toMatchObject({ windowMs: 3_600_000, totalLogs: 1 });
  });

  it('returns 400 invalid_query for an out-of-range or non-integer windowMs', async () => {
    const app = createApp();

    for (const value of ['0', '-1', '86400001', 'abc', '1.5']) {
      const response = await app.inject({
        method: 'GET',
        url: `/monitor/stats?windowMs=${value}`,
      });

      expect(response.statusCode, value).toBe(400);
      expect(response.json(), value).toMatchObject({
        error: { code: 'invalid_query' },
      });
    }
  });
});

describe('GET /monitor/events', () => {
  it('streams published logs as event: log without logging its own stream', async () => {
    const app = createApp();
    const baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });
    const sse = connectSse(`${baseUrl}/monitor/events`);

    await sse.ready;
    expect(sse.text()).toContain(': connected');

    const created = app.observability.log({
      category: 'system',
      level: 'debug',
      message: 'probe',
      payload: { answer: 42 },
      durationMs: 7,
    });

    const text = await sse.waitFor((value) => value.includes('event: log'));

    expect(text).toContain('event: log\ndata: ');
    expect(logEvent(text)).toMatchObject({
      id: created.id,
      category: 'system',
      level: 'debug',
      message: 'probe',
      payload: { answer: 42 },
      durationMs: 7,
    });

    // Opening and using the monitor stream must not feed itself new records.
    expect(
      app.observability.repository.query({ category: 'http' }).total,
    ).toBe(0);
    expect(
      app.observability.repository.query({ category: 'sse' }).total,
    ).toBe(0);

    sse.close();
    await app.close();
    openApps.splice(openApps.indexOf(app), 1);
  });

  it('pushes every log published after subscribing', async () => {
    const app = createApp();
    const baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });
    const sse = connectSse(`${baseUrl}/monitor/events`);

    await sse.ready;

    app.observability.log({ category: 'system', message: 'first' });
    app.observability.log({ category: 'system', message: 'second' });

    const text = await sse.waitFor((value) =>
      value.split('event: log').length > 2,
    );
    const messages = text
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => (JSON.parse(line.slice('data: '.length)) as AgentLog).message);

    expect(messages).toEqual(expect.arrayContaining(['first', 'second']));

    sse.close();
    await app.close();
    openApps.splice(openApps.indexOf(app), 1);
  });
});

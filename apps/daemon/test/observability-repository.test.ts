import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/storage/database.js';
import { AgentLogRepository } from '../src/observability/repository.js';

function createRepository(): AgentLogRepository {
  return new AgentLogRepository(openDatabase(':memory:'));
}

describe('AgentLogRepository', () => {
  it('round-trips a structured record with a JSON payload', () => {
    const repository = createRepository();

    const created = repository.insert({
      traceId: 'trace-1',
      spanId: 'span-1',
      parentId: 'span-0',
      timestamp: 1_000,
      level: 'warn',
      category: 'http',
      message: 'slow_request',
      payload: { method: 'GET', path: '/paint/canvas', nested: { ok: true } },
      durationMs: 321,
      canvasId: 'canvas-1',
      revision: 7,
      actor: 'user',
    });

    expect(created).toMatchObject({
      traceId: 'trace-1',
      spanId: 'span-1',
      parentId: 'span-0',
      timestamp: 1_000,
      level: 'warn',
      category: 'http',
      message: 'slow_request',
      payload: { method: 'GET', path: '/paint/canvas', nested: { ok: true } },
      durationMs: 321,
      error: null,
      canvasId: 'canvas-1',
      revision: 7,
      actor: 'user',
    });
    expect(repository.findById(created.id)).toEqual(created);
  });

  it('filters by category, level, canvas and time range', () => {
    const repository = createRepository();

    repository.insert({
      timestamp: 100,
      level: 'info',
      category: 'http',
      message: 'request',
      canvasId: 'a',
    });
    repository.insert({
      timestamp: 200,
      level: 'error',
      category: 'http',
      message: 'failed_request',
      canvasId: 'a',
    });
    repository.insert({
      timestamp: 300,
      level: 'error',
      category: 'canvas-action',
      message: 'layer_create',
      canvasId: 'b',
    });
    repository.insert({
      timestamp: 400,
      level: 'debug',
      category: 'codex-runner',
      message: 'codex_delta',
    });

    expect(
      repository.query({ category: 'http' }).items.map((item) => item.message),
    ).toEqual(['failed_request', 'request']);

    expect(
      repository.query({ category: ['http', 'codex-runner'], level: 'debug' }).items,
    ).toHaveLength(1);

    expect(
      repository.query({ canvasId: 'a', since: 150 }).items.map((item) => item.message),
    ).toEqual(['failed_request']);

    expect(repository.query({ until: 250 }).total).toBe(2);
    expect(repository.query({ traceId: 'missing' }).total).toBe(0);
  });

  it('paginates newest first and reports the total', () => {
    const repository = createRepository();

    for (let index = 0; index < 5; index += 1) {
      repository.insert({
        timestamp: 1_000 + index,
        category: 'system',
        message: `event_${index}`,
      });
    }

    const first = repository.query({ limit: 2 });

    expect(first.total).toBe(5);
    expect(first.limit).toBe(2);
    expect(first.offset).toBe(0);
    expect(first.items.map((item) => item.message)).toEqual(['event_4', 'event_3']);

    const second = repository.query({ limit: 2, offset: 2 });

    expect(second.items.map((item) => item.message)).toEqual(['event_2', 'event_1']);
  });

  it('caps an oversized page limit', () => {
    const repository = createRepository();

    expect(repository.query({ limit: 10_000 }).limit).toBe(500);
  });

  it('returns trace records in chronological order', () => {
    const repository = createRepository();

    repository.insert({
      traceId: 'trace-1',
      spanId: 'late',
      timestamp: 300,
      category: 'ai-chat',
      message: 'sse_complete',
    });
    repository.insert({
      traceId: 'trace-1',
      spanId: 'early',
      timestamp: 100,
      category: 'ai-chat',
      message: 'prompt_built',
    });
    repository.insert({
      traceId: 'trace-2',
      spanId: 'other',
      timestamp: 200,
      category: 'ai-chat',
      message: 'other_trace',
    });

    expect(repository.findTrace('trace-1').map((item) => item.spanId)).toEqual([
      'early',
      'late',
    ]);
  });

  it('aggregates stats inside the window', () => {
    const repository = createRepository();

    repository.insert({
      timestamp: 10_000,
      level: 'info',
      category: 'http',
      message: 'http_request',
      durationMs: 10,
    });
    repository.insert({
      timestamp: 20_000,
      level: 'error',
      category: 'http',
      message: 'http_request',
      durationMs: 30,
    });
    repository.insert({
      timestamp: 30_000,
      level: 'info',
      category: 'ai-chat',
      message: 'chat_completed',
      durationMs: 100,
    });
    repository.insert({
      timestamp: 40_000,
      level: 'error',
      category: 'ai-chat',
      message: 'chat_completed',
    });
    repository.insert({
      timestamp: 45_000,
      level: 'warn',
      category: 'ai-chat',
      message: 'chat_completed',
    });
    repository.insert({
      timestamp: 50_000,
      level: 'info',
      category: 'codex-runner',
      message: 'codex_spawn',
    });
    repository.insert({
      timestamp: 5_000,
      category: 'http',
      message: 'outside_window',
    });

    const stats = repository.stats({ now: 60_000, windowMs: 50_000 });

    expect(stats).toMatchObject({
      windowMs: 50_000,
      totalLogs: 6,
      errorCount: 2,
      errorRate: 0.5,
      requestCount: 2,
      requestsPerSecond: 0.04,
      avgDurationMs: 20,
      aiChatCount: 3,
      aiChatSuccessCount: 1,
      aiChatSuccessRate: 0.333,
    });
    expect(stats.categoryCounts).toEqual([
      { category: 'codex-runner', count: 1, errorCount: 0 },
      { category: 'ai-chat', count: 3, errorCount: 1 },
      { category: 'canvas-action', count: 0, errorCount: 0 },
      { category: 'http', count: 2, errorCount: 1 },
      { category: 'sse', count: 0, errorCount: 0 },
      { category: 'system', count: 0, errorCount: 0 },
    ]);
  });
});

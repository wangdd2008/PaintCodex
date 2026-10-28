import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/storage/database.js';
import { AgentLogRepository } from '../src/observability/repository.js';

function createRepository(): AgentLogRepository {
  return new AgentLogRepository(openDatabase(':memory:'));
}

describe('AgentLogRepository.summarizeTraces', () => {
  it('聚合窗口内每个 trace 的起止、节点数与错误数，并按开始时间倒序', () => {
    const repository = createRepository();

    // trace-a：根 span 在 1000；一个 error 子 span 结束于 1200+500。
    repository.insert({
      traceId: 'trace-a',
      spanId: 'root-a',
      timestamp: 1_000,
      category: 'ai-chat',
      message: 'ai_chat',
      actor: 'user',
    });
    repository.insert({
      traceId: 'trace-a',
      spanId: 'child-a',
      parentId: 'root-a',
      timestamp: 1_200,
      level: 'error',
      category: 'canvas-tool',
      message: 'tool_call',
      durationMs: 500,
    });
    repository.insert({
      traceId: 'trace-a',
      spanId: 'child-a2',
      parentId: 'root-a',
      timestamp: 1_500,
      category: 'sse',
      message: 'sse_publish',
      durationMs: 200,
    });

    // trace-b：开始更晚，排第一。
    repository.insert({
      traceId: 'trace-b',
      spanId: 'root-b',
      timestamp: 5_000,
      category: 'http',
      message: 'http_request',
      payload: { method: 'GET', path: '/paint/canvas' },
    });
    repository.insert({
      traceId: 'trace-b',
      spanId: 'child-b',
      parentId: 'root-b',
      timestamp: 5_100,
      category: 'codex-runtime',
      message: 'turn_start',
    });

    const page = repository.summarizeTraces({ now: 6_000, windowMs: 10_000 });

    expect(page.total).toBe(2);
    expect(page.windowMs).toBe(10_000);
    expect(page.items.map((item) => item.traceId)).toEqual(['trace-b', 'trace-a']);

    const a = page.items.find((item) => item.traceId === 'trace-a');
    expect(a).toMatchObject({
      startedAt: 1_000,
      endedAt: 1_700,
      spanCount: 3,
      errorCount: 1,
      rootMessage: 'ai_chat',
      actor: 'user',
    });

    const b = page.items.find((item) => item.traceId === 'trace-b');
    expect(b).toMatchObject({
      startedAt: 5_000,
      endedAt: 5_100,
      spanCount: 2,
      errorCount: 0,
      rootMessage: 'http_request',
      requestPath: '/paint/canvas',
    });
  });

  it('components 去重并按组件在本追踪中首次出现的顺序排列', () => {
    const repository = createRepository();

    // 时间顺序：browser → daemon → codex → daemon(重复) → 无方向内部事件。
    repository.insert({ traceId: 'trace-c', spanId: 's1', timestamp: 1_000, category: 'sse', message: 'sse_subscribe', source: 'browser', target: 'daemon' });
    repository.insert({ traceId: 'trace-c', spanId: 's2', parentId: 's1', timestamp: 1_100, category: 'codex-runtime', message: 'turn_start', source: 'daemon', target: 'codex' });
    repository.insert({ traceId: 'trace-c', spanId: 's3', parentId: 's2', timestamp: 1_200, category: 'canvas-tool', message: 'tool_call', source: 'codex', target: 'daemon' });
    repository.insert({ traceId: 'trace-c', spanId: 's4', parentId: 's1', timestamp: 1_300, category: 'sse', message: 'sse_publish', source: 'daemon', target: 'browser' });
    repository.insert({ traceId: 'trace-c', spanId: 's5', parentId: 's1', timestamp: 1_400, category: 'system', message: 'internal_event' });

    const page = repository.summarizeTraces({ now: 2_000, windowMs: 5_000 });

    expect(page).toMatchObject({ total: 1 });
    expect(page.items[0]).toMatchObject({
      traceId: 'trace-c',
      components: ['browser', 'daemon', 'codex'],
    });
  });

  it('hasError 只返回 errorCount 大于 0 的追踪', () => {
    const repository = createRepository();

    repository.insert({ traceId: 'trace-ok', spanId: 'r', timestamp: 1_000, category: 'ai-chat', message: 'ai_chat', level: 'info' });
    repository.insert({ traceId: 'trace-ok', spanId: 'c', parentId: 'r', timestamp: 1_100, category: 'ai-chat', message: 'chat_completed', level: 'info' });

    repository.insert({ traceId: 'trace-err', spanId: 'r', timestamp: 2_000, category: 'ai-chat', message: 'ai_chat', level: 'info' });
    repository.insert({ traceId: 'trace-err', spanId: 'c', parentId: 'r', timestamp: 2_100, category: 'ai-chat', message: 'chat_completed', level: 'error', error: 'boom' });

    const all = repository.summarizeTraces({ now: 3_000, windowMs: 5_000 });
    expect(all.total).toBe(2);

    const errorsOnly = repository.summarizeTraces({ now: 3_000, windowMs: 5_000, hasError: true });
    expect(errorsOnly.total).toBe(1);
    expect(errorsOnly.items.map((item) => item.traceId)).toEqual(['trace-err']);
    expect(errorsOnly.items[0]?.errorCount).toBe(1);
  });

  it('canvasId 下钻只返回触碰过该画布的追踪，但节点数仍算整段', () => {
    const repository = createRepository();

    // trace-x 碰了 canvas-a，另有一条无画布记录；spanCount 应是 2 而不是 1。
    repository.insert({ traceId: 'trace-x', spanId: 'r', timestamp: 1_000, category: 'ai-chat', message: 'ai_chat', canvasId: 'canvas-a' });
    repository.insert({ traceId: 'trace-x', spanId: 'c', parentId: 'r', timestamp: 1_100, category: 'canvas-action', message: 'layer_create' });

    repository.insert({ traceId: 'trace-y', spanId: 'r', timestamp: 2_000, category: 'ai-chat', message: 'ai_chat', canvasId: 'canvas-b' });

    const page = repository.summarizeTraces({ now: 3_000, windowMs: 5_000, canvasId: 'canvas-a' });

    expect(page.total).toBe(1);
    expect(page.items[0]).toMatchObject({
      traceId: 'trace-x',
      spanCount: 2,
      canvasId: 'canvas-a',
    });
  });

  it('只聚合窗口内的记录，窗口外的追踪整段不出现', () => {
    const repository = createRepository();

    repository.insert({ traceId: 'trace-old', spanId: 'r', timestamp: 100, category: 'system', message: 'old' });
    repository.insert({ traceId: 'trace-new', spanId: 'r', timestamp: 5_000, category: 'system', message: 'new' });

    const page = repository.summarizeTraces({ now: 6_000, windowMs: 5_000 });

    expect(page.total).toBe(1);
    expect(page.items.map((item) => item.traceId)).toEqual(['trace-new']);
  });

  it('空窗口返回空 items 与 0，而不是报错', () => {
    const repository = createRepository();

    const page = repository.summarizeTraces({ now: 6_000, windowMs: 5_000 });

    expect(page).toEqual({ items: [], total: 0, windowMs: 5_000 });
  });

  it('按开始时间倒序分页，total 始终是窗口内追踪总数', () => {
    const repository = createRepository();

    for (let index = 0; index < 5; index += 1) {
      repository.insert({
        traceId: `trace-${index}`,
        spanId: 'r',
        timestamp: 1_000 + index * 1_000,
        category: 'system',
        message: `event_${index}`,
      });
    }

    const first = repository.summarizeTraces({ now: 10_000, windowMs: 20_000, limit: 2 });
    expect(first.total).toBe(5);
    expect(first.items.map((item) => item.traceId)).toEqual(['trace-4', 'trace-3']);

    const second = repository.summarizeTraces({ now: 10_000, windowMs: 20_000, limit: 2, offset: 2 });
    expect(second.total).toBe(5);
    expect(second.items.map((item) => item.traceId)).toEqual(['trace-2', 'trace-1']);
  });

  it('没有 http span 时 requestPath 为 null', () => {
    const repository = createRepository();

    repository.insert({ traceId: 'trace-only-system', spanId: 'r', timestamp: 1_000, category: 'system', message: 'startup' });

    const page = repository.summarizeTraces({ now: 2_000, windowMs: 5_000 });

    expect(page.items[0]).toMatchObject({
      traceId: 'trace-only-system',
      rootMessage: 'startup',
      requestPath: null,
    });
  });

  // 性能基线（ADR-0012）：摘要必须带窗口，否则 GROUP BY trace_id 会随日志无界
  // 增长变慢。这里在文件库（非内存库）里铺 10 万行带索引数据，量一次真实查询耗时。
  it('在 10 万行数据上窗口内摘要查询保持在 300ms 以内', () => {
    const dir = mkdtempSync(join(tmpdir(), 'traces-bench-'));
    const dbPath = join(dir, 'bench.db');
    const db = openDatabase(dbPath);

    try {
      const repository = new AgentLogRepository(db);
      const now = Date.now();
      const traceCount = 2_000;
      const rowsPerTrace = 50;

      const insert = db.prepare(`INSERT INTO agent_logs
        (trace_id, span_id, parent_id, timestamp, level, category, message, payload,
         duration_ms, canvas_id, actor, source, target)
        VALUES (@trace_id, @span_id, @parent_id, @timestamp, @level, @category, @message,
                @payload, @duration_ms, @canvas_id, @actor, @source, @target)`);

      const seed = db.transaction(() => {
        for (let trace = 0; trace < traceCount; trace += 1) {
          for (let row = 0; row < rowsPerTrace; row += 1) {
            insert.run({
              trace_id: `trace-${trace}`,
              span_id: `trace-${trace}-${row}`,
              parent_id: row === 0 ? null : `trace-${trace}-${row - 1}`,
              timestamp: now - 3_600_000 + trace * 1_000 + row * 10,
              level: row % 10 === 0 ? 'error' : 'info',
              category: row % 3 === 0 ? 'http' : 'system',
              message: 'event',
              payload: row % 3 === 0 ? JSON.stringify({ path: '/paint/canvas' }) : null,
              duration_ms: row * 5,
              canvas_id: 'canvas-1',
              actor: 'user',
              source: row % 3 === 0 ? 'browser' : null,
              target: null,
            });
          }
        }
      });
      seed();

      // 预热一次，排除首次读盘的冷启动；再连跑多次取中位数，避免 Windows 上
      // 杀软/后台进程造成的单次抖动。票允许环境慢时放宽到 1000ms，但索引必须建。
      repository.summarizeTraces({ now, windowMs: 3_600_000 });

      const samples: number[] = [];

      for (let run = 0; run < 5; run += 1) {
        const started = performance.now();
        repository.summarizeTraces({ now, windowMs: 3_600_000 });
        samples.push(performance.now() - started);
      }

      const page = repository.summarizeTraces({ now, windowMs: 3_600_000 });
      samples.sort((a, b) => a - b);
      const median = samples[Math.floor(samples.length / 2)] ?? 0;

      expect(page.total).toBe(traceCount);
      expect(page.items).toHaveLength(50);
      // 记录实测值，便于在报告里说明。
      console.log(`[bench] 10 万行摘要查询各次耗时 ${samples.map((s) => s.toFixed(0)).join(', ')}ms；中位数 ${median.toFixed(1)}ms`);
      expect(median).toBeLessThan(1_000);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

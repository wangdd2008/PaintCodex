import { describe, expect, it, vi } from 'vitest';
import { ObservabilityEvents } from '../src/observability/events.js';
import { ObservabilityLogger } from '../src/observability/logger.js';
import { AgentLogRepository } from '../src/observability/repository.js';
import { openDatabase } from '../src/storage/database.js';

function createHarness() {
  const repository = new AgentLogRepository(openDatabase(':memory:'));
  const events = new ObservabilityEvents();
  let clock = 1_000;
  let counter = 0;
  const logger = new ObservabilityLogger(repository, events, {
    now: () => clock,
    newId: () => `id-${(counter += 1)}`,
  });

  return {
    repository,
    events,
    logger,
    advance: (milliseconds: number) => {
      clock += milliseconds;
    },
  };
}

describe('ObservabilityLogger', () => {
  it('writes a finished span with its duration and start timestamp', () => {
    const harness = createHarness();
    const trace = harness.logger.startTrace({
      category: 'http',
      message: 'http_request',
      payload: { method: 'GET', path: '/health' },
      canvasId: 'canvas-1',
      actor: 'user',
    });

    harness.advance(42);
    const finished = trace.finish({ level: 'info' });

    expect(finished).toMatchObject({
      traceId: 'id-1',
      spanId: 'id-2',
      parentId: null,
      timestamp: 1_000,
      durationMs: 42,
      category: 'http',
      message: 'http_request',
      payload: { method: 'GET', path: '/health' },
      canvasId: 'canvas-1',
      actor: 'user',
    });
    expect(trace.traceId).toBe('id-1');
    expect(trace.spanId).toBe('id-2');
  });

  it('links child spans and point logs to their parent span', () => {
    const harness = createHarness();
    const root = harness.logger.startTrace({
      category: 'ai-chat',
      message: 'chat',
    });

    harness.advance(5);
    const child = root.startSpan({
      category: 'codex-runtime',
      message: 'codex_exec',
    });

    harness.advance(10);
    const pointLog = root.log({
      level: 'debug',
      message: 'first_delta',
      payload: { delta: 'Hel' },
    });
    const childLog = child.finish({ level: 'info' });

    expect(child.traceId).toBe(root.traceId);
    expect(child.parentId).toBe(root.spanId);
    expect(pointLog).toMatchObject({
      traceId: root.traceId,
      parentId: root.spanId,
      category: 'ai-chat',
      message: 'first_delta',
      durationMs: null,
    });
    expect(pointLog.spanId).not.toBe(root.spanId);
    expect(childLog).toMatchObject({
      traceId: root.traceId,
      spanId: child.spanId,
      parentId: root.spanId,
      category: 'codex-runtime',
      message: 'codex_exec',
      durationMs: 10,
    });

    const traceRecords = harness.repository.findTrace(root.traceId);

    expect(traceRecords).toHaveLength(2);
    expect(traceRecords.map((record) => record.message)).toEqual([
      'codex_exec',
      'first_delta',
    ]);
  });

  it('normalizes errors and lets finish override the span payload', () => {
    const harness = createHarness();
    const trace = harness.logger.startTrace({
      category: 'codex-runtime',
      message: 'codex_run',
      payload: { step: 'spawn' },
    });

    harness.advance(3);
    const finished = trace.finish({
      level: 'error',
      message: 'codex_error',
      payload: { exitCode: 2 },
      error: new Error('Codex CLI exited with code 2'),
    });

    expect(finished.error).toBe('Codex CLI exited with code 2');
    expect(finished.payload).toEqual({ exitCode: 2 });
    expect(finished.level).toBe('error');
    expect(finished.message).toBe('codex_error');
  });

  it('stringifies non-Error failures and defaults the level to info', () => {
    const harness = createHarness();
    const log = harness.logger.log({
      category: 'system',
      message: 'migration_failed',
      error: 'disk full',
    });

    expect(log.level).toBe('info');
    expect(log.error).toBe('disk full');
    expect(log.traceId).toBeNull();
    expect(log.spanId).toBeNull();
  });

  it('publishes every persisted log to subscribers', () => {
    const harness = createHarness();
    const listener = vi.fn();
    harness.events.subscribe(listener);

    const trace = harness.logger.startTrace({
      category: 'canvas-action',
      message: 'layer_create',
    });
    harness.advance(7);
    const finished = trace.finish();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(finished);
  });

  it('gives a trace-scoped log a generated span id even without a span', () => {
    const harness = createHarness();
    const log = harness.logger.log({
      traceId: 'trace-x',
      category: 'http',
      message: 'detached',
    });

    expect(log.spanId).toBe('id-1');
    expect(log.traceId).toBe('trace-x');
    expect(log.parentId).toBeNull();
  });
});

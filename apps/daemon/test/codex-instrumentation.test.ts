import { describe, expect, it } from 'vitest';
import type { AgentLog } from '@paintcodex/protocol';
import { createCodexRunner } from '../src/paint/agent/codex-runner.js';
import { createObservability } from '../src/observability/index.js';
import { openDatabase } from '../src/storage/database.js';

const MESSAGE_EVENT = JSON.stringify({
  type: 'item.completed',
  item: { type: 'agent_message', text: 'hi' },
});

/** Runs the current Node binary as a stand-in for the Codex CLI. */
function nodeScript(script: string): string[] {
  return ['-e', script];
}

function createHarness() {
  const observability = createObservability(openDatabase(':memory:'));

  return {
    logger: observability.logger,
    records: (): AgentLog[] =>
      observability.repository.query({ category: 'codex-runner', limit: 100 }).items,
  };
}

describe('Codex runner instrumentation', () => {
  it('records spawn, delta and completion events inside the caller trace', async () => {
    const harness = createHarness();
    const trace = harness.logger.startTrace({
      category: 'ai-chat',
      message: 'codex_exec',
    });
    const runner = createCodexRunner({
      command: process.execPath,
      args: nodeScript(
        `process.stdout.write(${JSON.stringify(`${MESSAGE_EVENT}\n`)})`,
      ),
      logger: harness.logger,
      timeoutMs: 10_000,
    });

    const output = await runner.run('draw a cat', () => {}, undefined, trace);
    const records = harness.records();
    const spawn = records.find((record) => record.message === 'codex_spawn');
    const delta = records.find((record) => record.message === 'codex_delta');
    const complete = records.find((record) => record.message === 'codex_complete');

    expect(output).toBe('hi');
    expect(spawn).toMatchObject({
      level: 'info',
      traceId: trace.traceId,
      parentId: trace.spanId,
      payload: { command: process.execPath, argCount: 2, promptLength: 10 },
    });
    expect(spawn?.spanId).toBeTruthy();
    expect(spawn?.spanId).not.toBe(trace.spanId);
    expect(delta).toMatchObject({
      level: 'debug',
      traceId: trace.traceId,
      parentId: trace.spanId,
      payload: { delta: 'hi' },
    });
    expect(complete).toMatchObject({
      level: 'info',
      traceId: trace.traceId,
      parentId: trace.spanId,
      payload: { exitCode: 0, outputLength: 2 },
    });
    expect(typeof complete?.durationMs).toBe('number');
  });

  it('records an error with the exit code when the CLI exits non-zero', async () => {
    const harness = createHarness();
    const runner = createCodexRunner({
      command: process.execPath,
      args: nodeScript('process.exit(3)'),
      logger: harness.logger,
      timeoutMs: 10_000,
    });

    await expect(runner.run('draw a cat', () => {})).rejects.toThrow(
      /exited with code 3/,
    );

    const failure = harness
      .records()
      .find((record) => record.message === 'codex_error');

    expect(failure).toMatchObject({
      level: 'error',
      payload: { exitCode: 3 },
    });
    expect(failure?.error).toContain('exited with code 3');
    expect(typeof failure?.durationMs).toBe('number');
  });

  it('records a timeout with the configured deadline', async () => {
    const harness = createHarness();
    const runner = createCodexRunner({
      command: process.execPath,
      args: nodeScript('setTimeout(() => {}, 10_000)'),
      logger: harness.logger,
      timeoutMs: 150,
    });

    await expect(runner.run('draw a cat', () => {})).rejects.toThrow(/timed out/);

    const timeout = harness
      .records()
      .find((record) => record.message === 'codex_timeout');

    expect(timeout).toMatchObject({
      level: 'error',
      payload: { timeoutMs: 150 },
    });
    expect(timeout?.error).toContain('timed out after 150ms');
  });

  it('records an abort as a warning', async () => {
    const harness = createHarness();
    const runner = createCodexRunner({
      command: process.execPath,
      args: nodeScript('setTimeout(() => {}, 10_000)'),
      logger: harness.logger,
      timeoutMs: 10_000,
    });
    const controller = new AbortController();

    const pending = runner.run('draw a cat', () => {}, controller.signal);

    await new Promise((resolve) => setTimeout(resolve, 100));
    controller.abort();

    await expect(pending).rejects.toThrow(/aborted/);

    const abort = harness
      .records()
      .find((record) => record.message === 'codex_abort');

    expect(abort).toMatchObject({ level: 'warn' });
  });

  it('records a spawn failure as an error and stays silent without a logger', async () => {
    const harness = createHarness();
    const runner = createCodexRunner({
      command: 'paintcodex-missing-codex-binary',
      args: [],
      logger: harness.logger,
      timeoutMs: 10_000,
    });

    await expect(runner.run('draw a cat', () => {})).rejects.toThrow();

    const failure = harness
      .records()
      .find((record) => record.message === 'codex_error');

    expect(failure).toMatchObject({ level: 'error' });

    const unlogged = createCodexRunner({
      command: 'paintcodex-missing-codex-binary',
      args: [],
      timeoutMs: 10_000,
    });

    await expect(unlogged.run('draw a cat', () => {})).rejects.toThrow();
    expect(harness.records().filter((record) => record.message === 'codex_error'))
      .toHaveLength(1);
  });
});

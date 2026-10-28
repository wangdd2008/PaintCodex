import { afterEach, describe, expect, it } from 'vitest';
import type { AgentLog } from '@paintcodex/protocol';
import {
  createCodexRuntime,
  type CodexRuntime,
  type CodexThreadStore,
} from '../src/paint/agent/runtime/codex-runtime.js';
import type { CanvasToolSet } from '../src/paint/agent/runtime/tools.js';
import { createObservability } from '../src/observability/index.js';
import { openDatabase } from '../src/storage/database.js';

const TURN_ID = 'turn-1';

/**
 * A stand-in for `codex app-server` focused on thread lifecycle. Thread ids
 * encode persistence so a test can tell an ephemeral thread from a durable one,
 * and resume/delete can be told to fail without a real Codex CLI.
 */
function fakeThreadServer(options: { resumeFails?: boolean; deleteFails?: boolean } = {}): string[] {
  const script = `
const readline = require('node:readline');
const rl = readline.createInterface({ input: process.stdin });
const send = (value) => process.stdout.write(JSON.stringify(value) + '\\n');
const notify = (method, params) => send({ method, params, emittedAtMs: Date.now() });
const resumeFails = ${options.resumeFails === true};
const deleteFails = ${options.deleteFails === true};
let starts = 0;
rl.on('line', (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  const params = message.params || {};
  if (message.method === 'initialize') {
    send({ id: message.id, result: { userAgent: 'fake', codexHome: '/', platformFamily: 'windows', platformOs: 'windows' } });
    return;
  }
  if (message.method === 'thread/start') {
    starts += 1;
    const id = 'thread-' + starts + (params.ephemeral ? '-ephemeral' : '-persistent');
    send({ id: message.id, result: { thread: { id } } });
    return;
  }
  if (message.method === 'thread/resume') {
    if (resumeFails) {
      send({ id: message.id, error: { code: -32600, message: 'thread not found' } });
      return;
    }
    send({ id: message.id, result: { thread: { id: params.threadId } } });
    return;
  }
  if (message.method === 'thread/delete') {
    if (deleteFails) {
      send({ id: message.id, error: { code: -32600, message: 'delete failed' } });
      return;
    }
    send({ id: message.id, result: {} });
    return;
  }
  if (message.method === 'turn/start') {
    send({ id: message.id, result: { turn: { id: '${TURN_ID}' } } });
    notify('turn/completed', { threadId: params.threadId, turn: { id: '${TURN_ID}', status: 'completed', items: [] } });
    return;
  }
});
`;
  return ['-e', script];
}

function memoryThreadStore(initial: Record<string, string> = {}): CodexThreadStore & {
  entries: Map<string, string>;
} {
  const entries = new Map(Object.entries(initial));

  return {
    entries,
    load: (canvasId) => entries.get(canvasId) ?? null,
    save: (canvasId, threadId) => {
      entries.set(canvasId, threadId);
    },
    clear: (canvasId) => {
      entries.delete(canvasId);
    },
  };
}

function stubTools(): CanvasToolSet {
  return {
    declarations: [],
    execute: async () => ({ ok: true }),
  };
}

interface Harness {
  runtime: CodexRuntime;
  logs(): AgentLog[];
}

function harness(
  store: CodexThreadStore,
  options: { resumeFails?: boolean; deleteFails?: boolean } = {},
): Harness {
  const observability = createObservability(openDatabase(':memory:'));
  const runtime = createCodexRuntime({
    command: process.execPath,
    args: fakeThreadServer(options),
    threadStore: store,
    logger: observability.logger,
    requestTimeoutMs: 15_000,
  });
  runtimes.push(runtime);

  return {
    runtime,
    logs: () =>
      observability.repository.query({ category: 'codex-runtime', limit: 100 }).items,
  };
}

const runtimes: CodexRuntime[] = [];

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
});

function turn(
  runtime: CodexRuntime,
  canvasId = 'canvas-1',
  onNotice?: (notice: string) => void,
) {
  return runtime.startTurn({
    canvasId,
    prompt: 'draw a circle',
    tools: stubTools(),
    onDelta: () => {},
    ...(onNotice ? { onNotice } : {}),
  });
}

describe('Codex thread persistence', () => {
  it('creates a durable thread once, persists its id and reuses it on the next turn', async () => {
    const store = memoryThreadStore();
    const harnessed = harness(store);

    await turn(harnessed.runtime);
    expect(harnessed.runtime.getThreadId('canvas-1')).toBe('thread-1-persistent');
    expect(store.entries.get('canvas-1')).toBe('thread-1-persistent');

    await turn(harnessed.runtime);
    expect(harnessed.runtime.getThreadId('canvas-1')).toBe('thread-1-persistent');
    expect(
      harnessed.logs().filter((record) => record.message === 'thread_start'),
    ).toHaveLength(1);
  });

  it('resumes the stored thread after a daemon restart instead of starting a new one', async () => {
    const store = memoryThreadStore({ 'canvas-1': 'thread-remembered' });
    const harnessed = harness(store);

    await turn(harnessed.runtime);

    expect(harnessed.runtime.getThreadId('canvas-1')).toBe('thread-remembered');
    expect(
      harnessed.logs().find((record) => record.message === 'thread_resume'),
    ).toMatchObject({
      level: 'info',
      // daemon 让 codex 恢复一个既有会话
      source: 'daemon',
      target: 'codex',
      payload: { threadId: 'thread-remembered' },
    });
    expect(
      harnessed.logs().some((record) => record.message === 'thread_start'),
    ).toBe(false);
  });

  it('starts a fresh thread, persists it and asks the user to notice when resume fails', async () => {
    const store = memoryThreadStore({ 'canvas-1': 'thread-archived' });
    const harnessed = harness(store, { resumeFails: true });
    const notices: string[] = [];

    await turn(harnessed.runtime, 'canvas-1', (notice) => notices.push(notice));

    expect(harnessed.runtime.getThreadId('canvas-1')).toBe('thread-1-persistent');
    expect(store.entries.get('canvas-1')).toBe('thread-1-persistent');
    expect(
      harnessed.logs().find((record) => record.message === 'thread_resume_failed'),
    ).toMatchObject({ level: 'warn', payload: { threadId: 'thread-archived' } });
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain('会话已重置');
  });

  it('deletes the thread of a canvas and forgets its stored id', async () => {
    const store = memoryThreadStore();
    const harnessed = harness(store);

    await turn(harnessed.runtime);
    await harnessed.runtime.deleteThread('canvas-1');

    expect(harnessed.runtime.getThreadId('canvas-1')).toBeNull();
    expect(store.entries.has('canvas-1')).toBe(false);
    expect(
      harnessed.logs().find((record) => record.message === 'thread_delete'),
    ).toMatchObject({ level: 'info' });
  });

  it('logs, without throwing, when the server refuses to delete the thread', async () => {
    const store = memoryThreadStore();
    const harnessed = harness(store, { deleteFails: true });

    await turn(harnessed.runtime);

    await expect(harnessed.runtime.deleteThread('canvas-1')).resolves.toBeUndefined();
    expect(
      harnessed.logs().find((record) => record.message === 'thread_delete_failed'),
    ).toMatchObject({ level: 'warn' });
  });
});

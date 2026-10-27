import { afterEach, describe, expect, it } from 'vitest';
import type { AgentLog } from '@paintcodex/protocol';
import {
  createCodexRuntime,
  probeCodexVersion,
  type CodexRuntime,
} from '../src/paint/agent/runtime/codex-runtime.js';
import type { CanvasToolSet } from '../src/paint/agent/runtime/tools.js';
import { createObservability } from '../src/observability/index.js';
import { openDatabase } from '../src/storage/database.js';

const THREAD_ID = 'thread-1';
const TURN_ID = 'turn-1';

/**
 * A stand-in for `codex app-server`: the current Node binary reads
 * newline-delimited JSON-RPC from stdin and answers the handful of methods the
 * runtime uses. Hooks inject per-test behaviour (deltas, tool calls, crashes)
 * without the test ever spawning a real Codex CLI.
 */
function fakeAppServer(hooks: {
  onTurnStart?: string;
  onToolResponse?: string;
} = {}): string[] {
  const script = `
const readline = require('node:readline');
const rl = readline.createInterface({ input: process.stdin });
const send = (value) => process.stdout.write(JSON.stringify(value) + '\\n');
const notify = (method, params) => send({ method, params, emittedAtMs: Date.now() });
const threadId = '${THREAD_ID}';
const turnId = '${TURN_ID}';
const toolCall = (tool, args) => ({
  id: 0,
  method: 'item/tool/call',
  params: { threadId, turnId, callId: 'call_1', namespace: null, tool, arguments: args },
});
rl.on('line', (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  const params = message.params || {};
  if (message.method === 'initialize') {
    send({ id: message.id, result: { userAgent: 'fake', codexHome: '/', platformFamily: 'windows', platformOs: 'windows' } });
    return;
  }
  if (message.method === 'thread/start') {
    send({ id: message.id, result: { thread: { id: threadId } } });
    return;
  }
  if (message.method === 'turn/start') {
    send({ id: message.id, result: { turn: { id: turnId } } });
    notify('turn/started', { threadId, turn: { id: turnId, status: 'inProgress' } });
    ${hooks.onTurnStart ?? ''}
    return;
  }
  if (message.method === 'turn/interrupt') {
    send({ id: message.id, result: {} });
    notify('turn/completed', { threadId, turn: { id: turnId, status: 'interrupted', items: [] } });
    return;
  }
  if (message.method === undefined && message.id === 0) {
    ${hooks.onToolResponse ?? ''}
    return;
  }
});
`;
  return ['-e', script];
}

function stubTools(execute: CanvasToolSet['execute']): CanvasToolSet {
  return {
    declarations: [
      {
        type: 'function',
        name: 'canvas_get_context',
        description: 'Read the canvas.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      },
    ],
    execute,
  };
}

function harness(options: {
  hooks?: Parameters<typeof fakeAppServer>[0];
  requestTimeoutMs?: number;
  toolTimeoutMs?: number;
} = {}) {
  const observability = createObservability(openDatabase(':memory:'));
  const runtime = createCodexRuntime({
    command: process.execPath,
    args: fakeAppServer(options.hooks),
    logger: observability.logger,
    requestTimeoutMs: options.requestTimeoutMs ?? 5_000,
    toolTimeoutMs: options.toolTimeoutMs,
  });

  return {
    runtime,
    runtimeLogs: (): AgentLog[] =>
      observability.repository.query({ category: 'codex-runtime', limit: 100 }).items,
  };
}

/** Polls until `probe` returns a truthy value; used to observe in-flight turns. */
async function waitFor<T>(probe: () => T | null, timeoutMs = 3_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const value = probe();

    if (value) {
      return value;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error('timed out waiting for the runtime');
}

const runtimes: CodexRuntime[] = [];

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
});

function start(
  harnessed: ReturnType<typeof harness>,
  overrides: Partial<Parameters<CodexRuntime['startTurn']>[0]> = {},
) {
  runtimes.push(harnessed.runtime);

  return harnessed.runtime.startTurn({
    canvasId: 'canvas-1',
    prompt: 'draw a circle',
    tools: stubTools(async () => ({ ok: true })),
    onDelta: () => {},
    ...overrides,
  });
}

describe('Codex runtime handshake and turns', () => {
  it('initializes with the experimental capability, starts a read-only thread and accumulates deltas', async () => {
    const harnessed = harness({
      hooks: {
        onTurnStart: `
    notify('item/agentMessage/delta', { threadId, turnId, itemId: 'item-1', delta: 'Hello ' });
    notify('item/agentMessage/delta', { threadId, turnId, itemId: 'item-1', delta: 'world' });
    process.stdout.write('not json at all\\n');
    notify('turn/completed', { threadId, turn: { id: turnId, status: 'completed', items: [] } });
`,
      },
    });
    const deltas: string[] = [];
    const result = await start(harnessed, {
      onDelta: (delta) => deltas.push(delta),
    });

    expect(result).toEqual({ text: 'Hello world', toolCallCount: 0 });
    expect(deltas).toEqual(['Hello ', 'world']);

    const threadStart = harnessed
      .runtimeLogs()
      .find((record) => record.message === 'thread_start');

    expect(threadStart).toMatchObject({
      level: 'info',
      payload: { sandbox: 'read-only', toolCount: 1 },
    });
    expect(harnessed.runtime.getThreadId('canvas-1')).toBe(THREAD_ID);
  });

  it('rejects the turn when Codex reports a failed turn', async () => {
    const harnessed = harness({
      hooks: {
        onTurnStart: `
    notify('turn/completed', {
      threadId,
      turn: { id: turnId, status: 'failed', items: [], error: { message: 'model exploded' } },
    });
`,
      },
    });

    await expect(start(harnessed)).rejects.toThrow(/model exploded/);
  });

  it('rejects pending work when the app-server crashes', async () => {
    const runtime = createCodexRuntime({
      command: process.execPath,
      args: ['-e', 'process.exit(7)'],
      requestTimeoutMs: 2_000,
    });
    runtimes.push(runtime);

    await expect(
      runtime.startTurn({
        canvasId: 'canvas-1',
        prompt: 'draw',
        tools: stubTools(async () => ({ ok: true })),
        onDelta: () => {},
      }),
    ).rejects.toThrow(/代码 7/);
  });
});

describe('Codex runtime dynamic tools', () => {
  it('executes a tool call and answers the server request with the same id', async () => {
    const calls: Array<{ tool: string; args: unknown }> = [];
    const harnessed = harness({
      hooks: {
        onTurnStart: `
    notify('item/agentMessage/delta', { threadId, turnId, itemId: 'item-1', delta: 'reading' });
    send(toolCall('canvas_get_context', { canvasId: 'canvas-1' }));
`,
        onToolResponse: `
    if (message.result?.success !== true) {
      notify('turn/completed', { threadId, turn: { id: turnId, status: 'failed', items: [], error: { message: 'tool result was not a success' } } });
      return;
    }
    const text = message.result.contentItems?.[0]?.text;
    if (text !== JSON.stringify({ ok: true, revision: 3 })) {
      notify('turn/completed', { threadId, turn: { id: turnId, status: 'failed', items: [], error: { message: 'unexpected tool content: ' + text } } });
      return;
    }
    notify('turn/completed', { threadId, turn: { id: turnId, status: 'completed', items: [] } });
`,
      },
    });

    const result = await start(harnessed, {
      tools: stubTools(async (tool, args) => {
        calls.push({ tool, args });
        return { ok: true, revision: 3 };
      }),
    });

    expect(result).toEqual({ text: 'reading', toolCallCount: 1 });
    expect(calls).toEqual([
      { tool: 'canvas_get_context', args: { canvasId: 'canvas-1' } },
    ]);
    expect(
      harnessed.runtimeLogs().some((record) => record.message === 'tool_call'),
    ).toBe(true);
  });

  it('reports a failing tool result back to the model instead of hanging the turn', async () => {
    const harnessed = harness({
      hooks: {
        onTurnStart: `send(toolCall('canvas_create_layer', { canvasId: 'canvas-1' }));`,
        onToolResponse: `
    if (message.result?.success !== false) {
      notify('turn/completed', { threadId, turn: { id: turnId, status: 'failed', items: [], error: { message: 'expected a failed tool result' } } });
      return;
    }
    const text = message.result.contentItems?.[0]?.text ?? '';
    if (!text.includes('invalid_svg')) {
      notify('turn/completed', { threadId, turn: { id: turnId, status: 'failed', items: [], error: { message: 'missing failure code: ' + text } } });
      return;
    }
    notify('turn/completed', { threadId, turn: { id: turnId, status: 'completed', items: [] } });
`,
      },
    });

    const result = await start(harnessed, {
      tools: stubTools(async () => ({
        ok: false,
        code: 'invalid_svg',
        message: 'SVG 不安全',
      })),
    });

    expect(result.toolCallCount).toBe(1);
  });

  it('answers unknown tools and timed-out tools so the turn can complete', async () => {
    const harnessed = harness({
      toolTimeoutMs: 50,
      hooks: {
        onTurnStart: `send(toolCall('canvas_get_context', {}));`,
        onToolResponse: `
    if (message.result?.success !== false) {
      notify('turn/completed', { threadId, turn: { id: turnId, status: 'failed', items: [], error: { message: 'expected a timeout failure' } } });
      return;
    }
    notify('turn/completed', { threadId, turn: { id: turnId, status: 'completed', items: [] } });
`,
      },
    });

    await start(harnessed, {
      tools: stubTools(() => new Promise(() => {})),
    });

    expect(harnessed.runtimeLogs().some((record) => record.message === 'tool_timeout'))
      .toBe(true);
  });
});

describe('Codex runtime interruption', () => {
  it('sends turn/interrupt and rejects the pending turn with an AbortError', async () => {
    const harnessed = harness();
    const pending = start(harnessed, {
      onDelta: () => {},
    });

    await waitFor(
      () => harnessed.runtime.getActiveTurn('canvas-1')?.turnId ?? null,
    );

    await expect(harnessed.runtime.interrupt('canvas-1')).resolves.toBeUndefined();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('interrupts the turn when the caller signal aborts', async () => {
    const harnessed = harness();
    const controller = new AbortController();
    const pending = start(harnessed, { signal: controller.signal });

    await waitFor(
      () => harnessed.runtime.getActiveTurn('canvas-1')?.turnId ?? null,
    );
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('Codex version gate', () => {
  it('accepts codex 0.164.0 and later', () => {
    expect(
      probeCodexVersion({
        command: process.execPath,
        args: ['-e', 'console.log("codex-cli 0.164.0")'],
      }),
    ).toEqual({ available: true, version: '0.164.0' });

    expect(
      probeCodexVersion({
        command: process.execPath,
        args: ['-e', 'console.log("codex-cli 0.170.2")'],
      }),
    ).toEqual({ available: true, version: '0.170.2' });
  });

  it('reports an actionable reason for an older CLI', () => {
    const probe = probeCodexVersion({
      command: process.execPath,
      args: ['-e', 'console.log("codex-cli 0.160.5")'],
    });

    expect(probe.available).toBe(false);
    expect(probe.available ? '' : probe.reason).toContain('0.164.0');
    expect(probe.available ? '' : probe.reason).toContain('0.160.5');
  });

  it('reports an actionable reason when the binary is missing', () => {
    const probe = probeCodexVersion({
      command: 'paintcodex-missing-codex-binary',
      args: ['--version'],
    });

    expect(probe.available).toBe(false);
    expect(probe.available ? '' : probe.reason).toContain('codex');
  });
});

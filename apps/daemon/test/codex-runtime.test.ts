import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentLog } from '@paintcodex/protocol';
import {
  createCodexRuntime,
  probeCodexVersion,
  type CodexRuntime,
} from '../src/paint/agent/runtime/codex-runtime.js';
import {
  createConfirmationChannel,
  type ConfirmFrameEvent,
  type ConfirmationChannel,
  type ConfirmationOutcome,
} from '../src/paint/agent/runtime/confirmation.js';
import type { CanvasToolSet } from '../src/paint/agent/runtime/tools.js';
import { createObservability } from '../src/observability/index.js';
import { openDatabase } from '../src/storage/database.js';

/**
 * Every test here spawns a real Node child as the fake app-server. Running the
 * whole workspace suite in parallel can push a single spawn/handshake past
 * Vitest's 5s default, so the file budget matches the runtime's 15s request
 * deadline instead of failing the test for being slow.
 */
vi.setConfig({ testTimeout: 30_000 });

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
let answered = 0;
const dynamicToolItem = (id, tool, overrides = {}) => ({
  type: 'dynamicToolCall',
  id,
  tool,
  arguments: {},
  status: 'inProgress',
  contentItems: null,
  success: null,
  ...overrides,
});
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
  if (message.method === undefined && typeof message.id === 'number') {
    answered += 1;
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
  confirmations?: ConfirmationChannel;
} = {}) {
  const observability = createObservability(openDatabase(':memory:'));
  const runtime = createCodexRuntime({
    command: process.execPath,
    args: fakeAppServer(options.hooks),
    logger: observability.logger,
    // 15s: the fake app-server is a real child process, and the full workspace
    // suite runs it while other packages are compiling; 5s flaked under load.
    requestTimeoutMs: options.requestTimeoutMs ?? 15_000,
    toolTimeoutMs: options.toolTimeoutMs,
    confirmations: options.confirmations,
  });

  return {
    runtime,
    runtimeLogs: (): AgentLog[] =>
      observability.repository.query({ category: 'codex-runtime', limit: 100 }).items,
  };
}

/** Polls until `probe` returns a truthy value; used to observe in-flight turns. */
async function waitFor<T>(probe: () => T | null, timeoutMs = 20_000): Promise<T> {
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

/**
 * In-process stand-in for a spawned app-server. The crash tests drive `exit`
 * and `close` themselves, so the assertion never races a real child's startup
 * against a request deadline (which is what made the old subprocess test flaky
 * under `pnpm -r test`).
 */
class FakeAppServerProcess extends EventEmitter {
  readonly pid = 4242;
  readonly writes: string[] = [];
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly stdin = {
    destroyed: false,
    write: (chunk: string) => {
      this.writes.push(chunk);
      return true;
    },
    on: () => this.stdin,
  };
  readonly stdout = Object.assign(new EventEmitter(), { setEncoding: () => {} });
  readonly stderr = Object.assign(new EventEmitter(), { setEncoding: () => {} });

  respond(value: unknown): void {
    this.stdout.emit('data', `${JSON.stringify(value)}\n`);
  }

  crash(code: number): void {
    this.exitCode = code;
    this.emit('exit', code, null);
    this.emit('close', code, null);
  }
}

function parsedWrite(process: FakeAppServerProcess, index: number) {
  const raw = process.writes[index];

  expect(raw).toBeTruthy();

  return JSON.parse(raw as string) as { id: number; method: string };
}

function runtimeWithFakeProcess(process: FakeAppServerProcess): CodexRuntime {
  return createCodexRuntime({
    spawn: () => process as unknown as ChildProcess,
    requestTimeoutMs: 30_000,
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

  it('rejects a pending request with the exit code when the app-server crashes', async () => {
    const child = new FakeAppServerProcess();
    const runtime = runtimeWithFakeProcess(child);
    runtimes.push(runtime);
    const pending = runtime.startTurn({
      canvasId: 'canvas-1',
      prompt: 'draw',
      tools: stubTools(async () => ({ ok: true })),
      onDelta: () => {},
    });
    const rejection = expect(pending).rejects.toThrow(/代码 7/);

    child.emit('spawn');
    await waitFor(() => (child.writes.length >= 1 ? child.writes.length : null));
    child.crash(7);

    await rejection;
  });

  it('settles the in-flight turn when the app-server crashes', async () => {
    const child = new FakeAppServerProcess();
    const runtime = runtimeWithFakeProcess(child);
    runtimes.push(runtime);
    const pending = runtime.startTurn({
      canvasId: 'canvas-1',
      prompt: 'draw',
      tools: stubTools(async () => ({ ok: true })),
      onDelta: () => {},
    });
    const rejection = expect(pending).rejects.toThrow(/代码 7/);

    child.emit('spawn');

    await waitFor(() => (child.writes.length >= 1 ? child.writes.length : null));
    const initialize = parsedWrite(child, 0);
    child.respond({
      id: initialize.id,
      result: {
        userAgent: 'fake',
        codexHome: '/',
        platformFamily: 'windows',
        platformOs: 'windows',
      },
    });

    await waitFor(() => (child.writes.length >= 2 ? child.writes.length : null));
    const threadStart = parsedWrite(child, 1);
    child.respond({ id: threadStart.id, result: { thread: { id: THREAD_ID } } });

    await waitFor(() => (child.writes.length >= 3 ? child.writes.length : null));
    const turnStart = parsedWrite(child, 2);
    child.respond({ id: turnStart.id, result: { turn: { id: TURN_ID } } });

    await waitFor(() => runtime.getActiveTurn('canvas-1')?.turnId ?? null);
    child.crash(7);

    await rejection;
    expect(runtime.getActiveTurn('canvas-1')).toBeNull();
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

describe('Codex runtime tool frames', () => {
  type ToolEvent = Parameters<NonNullable<Parameters<CodexRuntime['startTurn']>[0]['onToolEvent']>>[0];

  it('maps dynamicToolCall item events to running and ok frames', async () => {
    const events: ToolEvent[] = [];
    const harnessed = harness({
      hooks: {
        onTurnStart: `
    notify('item/started', { threadId, turnId, item: dynamicToolItem('call_1', 'canvas_update_layer') });
    send(toolCall('canvas_update_layer', { canvasId: 'canvas-1', layerId: 'layer-1', patch: {} }));
`,
        onToolResponse: `
    notify('item/completed', { threadId, turnId, item: dynamicToolItem('call_1', 'canvas_update_layer', { status: 'completed', success: true, contentItems: [] }) });
    notify('turn/completed', { threadId, turn: { id: turnId, status: 'completed', items: [] } });
`,
      },
    });

    const result = await start(harnessed, {
      tools: stubTools(async () => ({ ok: true, revision: 2 })),
      onToolEvent: (event) => events.push(event),
    });

    expect(result.toolCallCount).toBe(1);
    expect(events).toEqual([
      { id: 'call_1', name: 'canvas_update_layer', status: 'running' },
      { id: 'call_1', name: 'canvas_update_layer', status: 'ok' },
    ]);
  });

  it('carries the failure code on the failed frame', async () => {
    const events: ToolEvent[] = [];
    const harnessed = harness({
      hooks: {
        onTurnStart: `
    notify('item/started', { threadId, turnId, item: dynamicToolItem('call_1', 'canvas_delete_layer') });
    send(toolCall('canvas_delete_layer', { canvasId: 'canvas-1', layerId: 'missing' }));
`,
        onToolResponse: `
    notify('item/completed', { threadId, turnId, item: dynamicToolItem('call_1', 'canvas_delete_layer', { status: 'completed', success: false, contentItems: [] }) });
    notify('turn/completed', { threadId, turn: { id: turnId, status: 'completed', items: [] } });
`,
      },
    });

    await start(harnessed, {
      tools: stubTools(async () => ({
        ok: false,
        code: 'layer_not_found',
        message: '图层不存在',
      })),
      onToolEvent: (event) => events.push(event),
    });

    expect(events.at(-1)).toEqual({
      id: 'call_1',
      name: 'canvas_delete_layer',
      status: 'failed',
      code: 'layer_not_found',
    });
  });

  it('does not report a layer update as a created layer', async () => {
    const created: Array<{ id: string; name: string }> = [];
    const harnessed = harness({
      hooks: {
        onTurnStart: `send(toolCall('canvas_update_layer', { canvasId: 'canvas-1', layerId: 'layer-1', patch: {} }));`,
        onToolResponse: `
    notify('turn/completed', { threadId, turn: { id: turnId, status: 'completed', items: [] } });
`,
      },
    });

    await start(harnessed, {
      tools: stubTools(async () => ({
        ok: true,
        layer: { id: 'layer-1', name: 'AI — 红圆' },
        revision: 2,
      })),
      onLayerCreated: (layer) => created.push(layer),
    });

    expect(created).toEqual([]);
  });

  it('executes the tool calls of one turn strictly one at a time per canvas', async () => {
    const order: string[] = [];
    let releaseFirst: () => void = () => {};
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const harnessed = harness({
      hooks: {
        onTurnStart: `
    send({ id: 0, method: 'item/tool/call', params: { threadId, turnId, callId: 'call_1', namespace: null, tool: 'first', arguments: {} } });
    send({ id: 1, method: 'item/tool/call', params: { threadId, turnId, callId: 'call_2', namespace: null, tool: 'second', arguments: {} } });
`,
        onToolResponse: `
    if (answered < 2) {
      return;
    }
    notify('turn/completed', { threadId, turn: { id: turnId, status: 'completed', items: [] } });
`,
      },
    });

    const pending = start(harnessed, {
      tools: stubTools(async (tool) => {
        order.push(`start:${tool}`);

        if (tool === 'first') {
          await firstGate;
        }

        order.push(`end:${tool}`);
        return { ok: true };
      }),
    });

    await waitFor(() => (order.length > 0 ? order : null));
    // Give an unqueued second call every chance to start before asserting.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(order).toEqual(['start:first']);

    releaseFirst();
    await pending;

    expect(order).toEqual([
      'start:first',
      'end:first',
      'start:second',
      'end:second',
    ]);
  });
});

describe('Codex runtime render preview results', () => {
  const PNG = 'data:image/png;base64,AAAA';

  it('returns the rendered image as an inputImage content item', async () => {
    const harnessed = harness({
      hooks: {
        onTurnStart: `send(toolCall('canvas_render_preview', { canvasId: 'canvas-1' }));`,
        onToolResponse: `
    const items = message.result?.contentItems ?? [];
    const image = items.find((item) => item.type === 'inputImage');
    const text = items.find((item) => item.type === 'inputText')?.text ?? '';
    if (message.result?.success !== true || !image || image.imageUrl !== '${PNG}') {
      notify('turn/completed', { threadId, turn: { id: turnId, status: 'failed', items: [], error: { message: 'missing inputImage: ' + JSON.stringify(items) } } });
      return;
    }
    if (text.includes('${PNG}')) {
      notify('turn/completed', { threadId, turn: { id: turnId, status: 'failed', items: [], error: { message: 'image duplicated into text' } } });
      return;
    }
    notify('turn/completed', { threadId, turn: { id: turnId, status: 'completed', items: [] } });
`,
      },
    });

    const result = await start(harnessed, {
      requestRender: async () => ({ ok: true, imageUrl: PNG }),
      tools: stubTools(async (_tool, _args, context) => {
        const rendered = await context.requestRender!('canvas-1');
        return rendered;
      }),
    });

    expect(result.toolCallCount).toBe(1);
  });

  it('reports render_unavailable to the model when the browser never answers', async () => {
    const harnessed = harness({
      hooks: {
        onTurnStart: `send(toolCall('canvas_render_preview', { canvasId: 'canvas-1' }));`,
        onToolResponse: `
    const text = message.result?.contentItems?.[0]?.text ?? '';
    if (message.result?.success !== false || !text.includes('render_unavailable')) {
      notify('turn/completed', { threadId, turn: { id: turnId, status: 'failed', items: [], error: { message: 'expected render_unavailable: ' + text } } });
      return;
    }
    notify('turn/completed', { threadId, turn: { id: turnId, status: 'completed', items: [] } });
`,
      },
    });

    const result = await start(harnessed, {
      requestRender: async () => ({
        ok: false,
        code: 'render_unavailable' as const,
        message: '浏览器未在 10000ms 内返回画布预览',
      }),
      tools: stubTools(async (_tool, _args, context) => context.requestRender!('canvas-1')),
    });

    expect(result.toolCallCount).toBe(1);
  });

  it('cancels a pending render when the turn is interrupted', async () => {
    const harnessed = harness({
      hooks: {
        onTurnStart: `send(toolCall('canvas_render_preview', { canvasId: 'canvas-1' }));`,
      },
    });
    const controller = new AbortController();
    let renderSignal: AbortSignal | undefined;

    const pending = start(harnessed, {
      signal: controller.signal,
      requestRender: (_canvasId, signal) =>
        new Promise((resolve) => {
          renderSignal = signal;
          signal?.addEventListener('abort', () =>
            resolve({
              ok: false,
              code: 'render_unavailable',
              message: 'dirty',
            }),
          );
        }),
      tools: stubTools(async (_tool, _args, context) =>
        context.requestRender!('canvas-1'),
      ),
    });

    await waitFor(() => renderSignal ?? null);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(renderSignal?.aborted).toBe(true);
  });
});

describe('Codex runtime export results', () => {
  it('gives the model the downloaded filename and size, never image bytes', async () => {
    const harnessed = harness({
      hooks: {
        onTurnStart: `send(toolCall('canvas_export_png', { canvasId: 'canvas-1' }));`,
        onToolResponse: `
    const items = message.result?.contentItems ?? [];
    const image = items.find((item) => item.type === 'inputImage');
    const text = items.find((item) => item.type === 'inputText')?.text ?? '';
    if (message.result?.success !== true || image) {
      notify('turn/completed', { threadId, turn: { id: turnId, status: 'failed', items: [], error: { message: 'unexpected payload: ' + JSON.stringify(items) } } });
      return;
    }
    if (!text.includes('exported.png') || !text.includes('4321') || text.includes('data:image')) {
      notify('turn/completed', { threadId, turn: { id: turnId, status: 'failed', items: [], error: { message: 'bad export text: ' + text } } });
      return;
    }
    notify('turn/completed', { threadId, turn: { id: turnId, status: 'completed', items: [] } });
`,
      },
    });

    const result = await start(harnessed, {
      requestExport: async () => ({
        ok: true,
        filename: 'exported.png',
        bytes: 4321,
      }),
      tools: stubTools(async (_tool, _args, context) =>
        context.requestExport!('canvas-1'),
      ),
    });

    expect(result.toolCallCount).toBe(1);
  });

  it('pauses the tool deadline while the browser exports', async () => {
    const harnessed = harness({
      toolTimeoutMs: 30,
      hooks: {
        onTurnStart: `send(toolCall('canvas_export_png', { canvasId: 'canvas-1' }));`,
        onToolResponse: `
    if (message.result?.success !== true) {
      notify('turn/completed', { threadId, turn: { id: turnId, status: 'failed', items: [], error: { message: 'expected success: ' + JSON.stringify(message.result) } } });
      return;
    }
    notify('turn/completed', { threadId, turn: { id: turnId, status: 'completed', items: [] } });
`,
      },
    });

    const result = await start(harnessed, {
      requestExport: async () => {
        // Longer than the whole tool budget: only a suspended deadline passes.
        await new Promise((resolve) => setTimeout(resolve, 150));
        return { ok: true, filename: 'slow.png', bytes: 1 };
      },
      tools: stubTools(async (_tool, _args, context) =>
        context.requestExport!('canvas-1'),
      ),
    });

    expect(result.toolCallCount).toBe(1);
    expect(harnessed.runtimeLogs().some((record) => record.message === 'tool_timeout'))
      .toBe(false);
  });

  it('cancels a pending export when the turn is interrupted', async () => {
    const harnessed = harness({
      hooks: {
        onTurnStart: `send(toolCall('canvas_export_png', { canvasId: 'canvas-1' }));`,
      },
    });
    const controller = new AbortController();
    let exportSignal: AbortSignal | undefined;

    const pending = start(harnessed, {
      signal: controller.signal,
      requestExport: (_canvasId, signal) =>
        new Promise((resolve) => {
          exportSignal = signal;
          signal?.addEventListener('abort', () =>
            resolve({
              ok: false,
              code: 'export_unavailable',
              message: 'dirty',
            }),
          );
        }),
      tools: stubTools(async (_tool, _args, context) =>
        context.requestExport!('canvas-1'),
      ),
    });

    await waitFor(() => exportSignal ?? null);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(exportSignal?.aborted).toBe(true);
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

describe('Codex runtime confirmations', () => {
  const channels: ConfirmationChannel[] = [];

  afterEach(() => {
    for (const channel of channels.splice(0)) {
      channel.close();
    }
  });

  function confirmationChannel(timeoutMs = 5_000): ConfirmationChannel {
    const channel = createConfirmationChannel({ timeoutMs });

    channels.push(channel);

    return channel;
  }

  function confirmationTools(onOutcome: (outcome: ConfirmationOutcome) => void): CanvasToolSet {
    return stubTools(async (_tool, _args, context) => {
      const outcome = await context.requestConfirmation?.({
        title: '删除图层「红圆」',
        detail: '删除后无法恢复',
      });

      onOutcome(outcome ?? 'disconnected');

      return outcome === 'approved'
        ? { ok: true, revision: 2 }
        : { ok: false, code: 'user_declined', message: `未执行：${outcome}` };
    });
  }

  /** Validates the tool response the runtime sends back before completing. */
  function toolResponseHooks(expectedSuccess: boolean) {
    return {
      onTurnStart: `
    send(toolCall('canvas_delete_layer', { canvasId: 'canvas-1', layerId: 'layer-1' }));
`,
      onToolResponse: `
    const text = message.result?.contentItems?.[0]?.text ?? '';
    if (message.result?.success !== ${expectedSuccess ? 'true' : 'false'}) {
      notify('turn/completed', { threadId, turn: { id: turnId, status: 'failed', items: [], error: { message: 'unexpected tool success: ' + text } } });
      return;
    }
    if (${expectedSuccess ? 'false' : '!text.includes("user_declined")'}) {
      notify('turn/completed', { threadId, turn: { id: turnId, status: 'failed', items: [], error: { message: 'missing user_declined: ' + text } } });
      return;
    }
    notify('turn/completed', { threadId, turn: { id: turnId, status: 'completed', items: [] } });
`,
    };
  }

  it('emits a confirm frame, suspends the tool and resumes after approval', async () => {
    const channel = confirmationChannel();
    const frames: ConfirmFrameEvent[] = [];
    let outcome: ConfirmationOutcome | null = null;
    const harnessed = harness({
      hooks: toolResponseHooks(true),
      confirmations: channel,
    });

    const pending = start(harnessed, {
      tools: confirmationTools((value) => {
        outcome = value;
      }),
      onConfirm: (frame) => frames.push(frame),
    });

    await waitFor(() => (frames[0] ?? null));
    expect(frames[0]).toMatchObject({
      id: expect.any(String),
      title: '删除图层「红圆」',
      detail: '删除后无法恢复',
    });
    expect(channel.pendingCount()).toBe(1);
    expect(outcome).toBeNull();

    expect(channel.answer(frames[0]?.id as string, true, 'canvas-1')).toMatchObject({
      status: 'approved',
    });

    const result = await pending;

    expect(result.toolCallCount).toBe(1);
    expect(outcome).toBe('approved');
  });

  it('answers the model with user_declined when the confirmation times out', async () => {
    const channel = confirmationChannel(20);
    let outcome: ConfirmationOutcome | null = null;
    const harnessed = harness({
      hooks: toolResponseHooks(false),
      confirmations: channel,
    });

    const result = await start(harnessed, {
      tools: confirmationTools((value) => {
        outcome = value;
      }),
    });

    expect(result.toolCallCount).toBe(1);
    expect(outcome).toBe('timeout');
    expect(channel.pendingCount()).toBe(0);
  });

  it('does not let the 30s tool deadline preempt the 60s confirmation wait', async () => {
    const channel = confirmationChannel(120);
    let outcome: ConfirmationOutcome | null = null;
    const harnessed = harness({
      hooks: toolResponseHooks(false),
      toolTimeoutMs: 40,
      confirmations: channel,
    });

    const result = await start(harnessed, {
      tools: confirmationTools((value) => {
        outcome = value;
      }),
    });

    expect(result.toolCallCount).toBe(1);
    // The tool timer is paused while the user is being asked: a timeout here
    // would be the confirmation deadline, never `tool_timeout`.
    expect(outcome).toBe('timeout');
    expect(channel.pendingCount()).toBe(0);
  });

  it('refuses the suspended tool when the caller signal aborts (client disconnect)', async () => {
    const channel = confirmationChannel();
    const frames: ConfirmFrameEvent[] = [];
    let outcome: ConfirmationOutcome | null = null;
    const harnessed = harness({
      hooks: toolResponseHooks(false),
      confirmations: channel,
    });
    const controller = new AbortController();
    const pending = start(harnessed, {
      signal: controller.signal,
      tools: confirmationTools((value) => {
        outcome = value;
      }),
      onConfirm: (frame) => frames.push(frame),
    });

    await waitFor(() => (frames[0] ?? null));
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await waitFor(() => outcome);
    expect(outcome).toBe('disconnected');
    expect(channel.pendingCount()).toBe(0);
  });

  it('refuses the suspended tool when the turn is interrupted', async () => {
    const channel = confirmationChannel();
    const frames: ConfirmFrameEvent[] = [];
    let outcome: ConfirmationOutcome | null = null;
    const harnessed = harness({
      hooks: toolResponseHooks(false),
      confirmations: channel,
    });
    const pending = start(harnessed, {
      tools: confirmationTools((value) => {
        outcome = value;
      }),
      onConfirm: (frame) => frames.push(frame),
    });

    await waitFor(() => (frames[0] ?? null));
    await harnessed.runtime.interrupt('canvas-1');

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await waitFor(() => outcome);
    expect(outcome).toBe('interrupted');
    expect(channel.pendingCount()).toBe(0);
  });

  it('cancels pending confirmations when the runtime closes', async () => {
    const channel = confirmationChannel();
    const frames: ConfirmFrameEvent[] = [];
    let outcome: ConfirmationOutcome | null = null;
    const harnessed = harness({
      hooks: toolResponseHooks(false),
      confirmations: channel,
    });
    const pending = start(harnessed, {
      tools: confirmationTools((value) => {
        outcome = value;
      }),
      onConfirm: (frame) => frames.push(frame),
    });

    await waitFor(() => (frames[0] ?? null));
    // Attach before closing: `close()` rejects the turn while it also waits for
    // the child process to exit, and Node flags a late handler as unhandled.
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await harnessed.runtime.close();
    await rejection;

    await waitFor(() => outcome);
    expect(outcome).toBe('interrupted');
    expect(channel.pendingCount()).toBe(0);
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

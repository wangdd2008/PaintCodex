import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AgentLog } from '@paintcodex/protocol';
import type { CodexTurnInput } from '../src/paint/agent/runtime/codex-runtime.js';
import { buildServer } from '../src/api/server.js';
import { fakeRuntime } from './helpers/fake-runtime.js';

const RED_CIRCLE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080"><circle cx="960" cy="540" r="120" fill="red"/></svg>';

function logsIn(app: FastifyInstance, category: 'ai-chat' | 'canvas-tool'): AgentLog[] {
  return app.observability.repository.query({ category, limit: 200 }).items;
}

function messages(app: FastifyInstance, message: string): AgentLog[] {
  return logsIn(app, 'ai-chat').filter((log) => log.message === message);
}

function single(app: FastifyInstance, message: string): AgentLog {
  const found = messages(app, message);

  expect(found).toHaveLength(1);

  return found[0] as AgentLog;
}

async function waitForMessage(
  app: FastifyInstance,
  message: string,
  timeoutMs = 3_000,
): Promise<AgentLog | undefined> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const found = messages(app, message);

    if (found.length > 0) {
      return found[0];
    }

    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  return undefined;
}

async function runCreateLayer(
  input: CodexTurnInput,
  prompt: string,
): Promise<void> {
  const result = await input.tools.execute(
    'canvas_create_layer',
    { canvasId: input.canvasId, name: 'AI — Red circle', svg: RED_CIRCLE_SVG },
    { canvasId: input.canvasId, prompt, trace: input.trace },
  );

  if (result.ok) {
    input.onLayerCreated?.(result.layer as { id: string; name: string });
  }
}

describe('AI chat instrumentation', () => {
  it('records one chat trace with prompt, turn and sse events', async () => {
    const app = buildServer({
      dbPath: ':memory:',
      runtime: fakeRuntime(async (input) => {
        input.onDelta('Hel');
        input.onDelta('lo');

        return { text: 'Hello', toolCallCount: 0 };
      }),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/paint/ai/chat',
      payload: { message: 'Hello' },
    });

    const promptBuilt = single(app, 'prompt_built');
    const codexTurn = single(app, 'codex_turn');
    const sseComplete = single(app, 'sse_complete');
    const completed = single(app, 'chat_completed');
    const traceIds = new Set([
      promptBuilt.traceId,
      codexTurn.traceId,
      sseComplete.traceId,
      completed.traceId,
    ]);

    expect(response.statusCode).toBe(200);
    expect(traceIds.size).toBe(1);
    expect(completed.traceId).toBeTruthy();
    expect(promptBuilt).toMatchObject({
      level: 'debug',
      actor: 'agent',
      payload: { promptLength: expect.any(Number), hasCanvas: false, layerCount: 0 },
    });
    expect((promptBuilt.payload as Record<string, unknown>).prompt).toBeUndefined();
    expect(codexTurn).toMatchObject({
      traceId: completed.traceId,
      parentId: completed.spanId,
      level: 'info',
    });
    expect(typeof codexTurn.durationMs).toBe('number');
    expect(completed).toMatchObject({
      level: 'info',
      actor: 'agent',
      error: null,
      payload: {
        deltaCount: 2,
        assistantLength: 5,
        actionApplied: false,
      },
    });
    expect(typeof completed.durationMs).toBe('number');

    await app.close();
  });

  it('marks the chat as failed when the runtime throws', async () => {
    const app = buildServer({
      dbPath: ':memory:',
      runtime: fakeRuntime(async () => {
        throw new Error('codex exploded');
      }),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/paint/ai/chat',
      payload: { message: 'Hello' },
    });

    const completed = single(app, 'chat_completed');
    const codexTurn = single(app, 'codex_turn');

    expect(response.payload).toContain('"code":"ai_chat_failed"');
    expect(completed).toMatchObject({
      level: 'error',
      payload: { deltaCount: 0, assistantLength: 0, actionApplied: false },
    });
    expect(completed.error).toContain('codex exploded');
    expect(codexTurn).toMatchObject({ level: 'error' });

    await app.close();
  });

  it('records a created layer as a canvas-tool result and a layerCreated frame', async () => {
    const app = buildServer({
      dbPath: ':memory:',
      runtime: fakeRuntime(async (input) => {
        await runCreateLayer(input, input.userMessage ?? '');
        input.onDelta('Done.');

        return { text: 'Done.', toolCallCount: 1 };
      }),
    });
    const canvas = await app.inject({
      method: 'POST',
      url: '/paint/canvas',
      payload: {},
    });
    const canvasId = canvas.json().id as string;

    const response = await app.inject({
      method: 'POST',
      url: '/paint/ai/chat',
      payload: { message: 'Draw a red circle', canvasId },
    });

    const toolResult = logsIn(app, 'canvas-tool').find(
      (log) => log.message === 'tool_result',
    );
    const completed = single(app, 'chat_completed');

    expect(response.payload).toContain('"layerCreated"');
    expect(toolResult).toMatchObject({
      level: 'info',
      actor: 'agent',
      canvasId,
      payload: {
        tool: 'canvas_create_layer',
        ok: true,
        layerId: expect.any(String),
      },
    });
    expect(completed).toMatchObject({
      canvasId,
      actor: 'agent',
      level: 'info',
      payload: { actionApplied: true },
    });
    expect(messages(app, 'action_parse')).toHaveLength(0);
    expect(messages(app, 'action_apply')).toHaveLength(0);

    await app.close();
  });

  it('records no tool events for a plain conversation', async () => {
    const app = buildServer({
      dbPath: ':memory:',
      runtime: fakeRuntime(async (input) => {
        input.onDelta('Paris');

        return { text: 'Paris', toolCallCount: 0 };
      }),
    });

    await app.inject({
      method: 'POST',
      url: '/paint/ai/chat',
      payload: { message: 'Capital of France?' },
    });

    expect(logsIn(app, 'canvas-tool')).toHaveLength(0);
    expect(single(app, 'chat_completed')).toMatchObject({
      payload: { actionApplied: false },
    });

    await app.close();
  });

  it('records a client disconnect as a warning without an error event', async () => {
    const app = buildServer({
      dbPath: ':memory:',
      runtime: fakeRuntime(
        (input) =>
          new Promise((_resolve, reject) => {
            input.onDelta('partial');
            input.signal?.addEventListener(
              'abort',
              () => {
                const error = new Error('AI 轮次已中断');
                error.name = 'AbortError';
                reject(error);
              },
              { once: true },
            );
          }),
      ),
    });
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const controller = new AbortController();

    try {
      const response = await fetch(`${address}/paint/ai/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'Hello' }),
        signal: controller.signal,
      });
      const reader = response.body?.getReader();

      await reader?.read();
      controller.abort();

      const completed = await waitForMessage(app, 'chat_completed');

      expect(completed).toMatchObject({
        level: 'warn',
        payload: { aborted: true, actionApplied: false },
      });
    } finally {
      controller.abort();
      await app.close();
    }
  });
});

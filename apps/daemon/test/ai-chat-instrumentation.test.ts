import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AgentLog } from '@paintcodex/protocol';
import { buildServer } from '../src/api/server.js';
import type { CodexRunner } from '../src/paint/agent/codex-runner.js';
import { CANVAS_ACTION_MARKER } from '../src/paint/agent/canvas-action.js';

const RED_CIRCLE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080"><circle cx="960" cy="540" r="120" fill="red"/></svg>';

function actionText(name: string, svg: string): string {
  return `Drawing that now.\n${CANVAS_ACTION_MARKER}\n${JSON.stringify({ name, svg })}`;
}

function chatLogs(app: FastifyInstance): AgentLog[] {
  return app.observability.repository.query({
    category: 'ai-chat',
    limit: 200,
  }).items;
}

function messages(app: FastifyInstance, message: string): AgentLog[] {
  return chatLogs(app).filter((log) => log.message === message);
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

describe('AI chat instrumentation', () => {
  it('records one chat trace with prompt, codex and sse events', async () => {
    const runner: CodexRunner = {
      run: async (_prompt, onDelta) => {
        onDelta('Hel');
        onDelta('lo');
        return 'Hello';
      },
    };
    const app = buildServer({ dbPath: ':memory:', runner });

    const response = await app.inject({
      method: 'POST',
      url: '/paint/ai/chat',
      payload: { message: 'Hello' },
    });

    const promptBuilt = single(app, 'prompt_built');
    const codexExec = single(app, 'codex_exec');
    const sseComplete = single(app, 'sse_complete');
    const completed = single(app, 'chat_completed');
    const traceIds = new Set([
      promptBuilt.traceId,
      codexExec.traceId,
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
    expect(codexExec).toMatchObject({
      traceId: completed.traceId,
      parentId: completed.spanId,
      level: 'info',
    });
    expect(typeof codexExec.durationMs).toBe('number');
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

  it('marks the chat as failed when the runner throws', async () => {
    const runner: CodexRunner = {
      run: async () => {
        throw new Error('codex exploded');
      },
    };
    const app = buildServer({ dbPath: ':memory:', runner });

    const response = await app.inject({
      method: 'POST',
      url: '/paint/ai/chat',
      payload: { message: 'Hello' },
    });

    const completed = single(app, 'chat_completed');

    expect(response.payload).toContain('"code":"ai_chat_failed"');
    expect(completed).toMatchObject({
      level: 'error',
      payload: { deltaCount: 0, assistantLength: 0, actionApplied: false },
    });
    expect(completed.error).toContain('codex exploded');
    expect(messages(app, 'codex_exec')[0]).toMatchObject({ level: 'error' });

    await app.close();
  });

  it('records an applied canvas action with its layer id', async () => {
    const runner: CodexRunner = {
      run: async (_prompt, onDelta) => {
        const text = actionText('AI — Red circle', RED_CIRCLE_SVG);
        onDelta(text);
        return text;
      },
    };
    const app = buildServer({ dbPath: ':memory:', runner });
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

    const actionParse = single(app, 'action_parse');
    const actionApply = single(app, 'action_apply');
    const completed = single(app, 'chat_completed');

    expect(response.payload).toContain('"layerCreated"');
    expect(actionParse).toMatchObject({
      level: 'debug',
      payload: { hasAction: true, actionName: 'AI — Red circle' },
    });
    expect(actionApply).toMatchObject({
      level: 'info',
      traceId: completed.traceId,
      payload: { layerId: expect.any(String), actionName: 'AI — Red circle' },
    });
    expect(completed).toMatchObject({
      canvasId,
      actor: 'agent',
      level: 'info',
      payload: { actionApplied: true },
    });

    await app.close();
  });

  it('does not record action events for a plain conversation', async () => {
    const runner: CodexRunner = {
      run: async (_prompt, onDelta) => {
        onDelta('Paris');
        return 'Paris';
      },
    };
    const app = buildServer({ dbPath: ':memory:', runner });

    await app.inject({
      method: 'POST',
      url: '/paint/ai/chat',
      payload: { message: 'Capital of France?' },
    });

    expect(single(app, 'action_parse')).toMatchObject({
      payload: { hasAction: false },
    });
    expect(messages(app, 'action_apply')).toHaveLength(0);
    expect(single(app, 'chat_completed')).toMatchObject({
      payload: { actionApplied: false },
    });

    await app.close();
  });

  it('records a client disconnect as a warning without an error event', async () => {
    const runner: CodexRunner = {
      run: (_prompt, onDelta, signal) =>
        new Promise<string>((_resolve, reject) => {
          onDelta('partial');
          signal?.addEventListener(
            'abort',
            () => {
              const error = new Error('Codex request aborted');
              error.name = 'AbortError';
              reject(error);
            },
            { once: true },
          );
        }),
    };
    const app = buildServer({ dbPath: ':memory:', runner });
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

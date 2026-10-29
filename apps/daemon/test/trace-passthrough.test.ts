import { request as httpRequest } from 'node:http';
import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AgentLog } from '@paintcodex/protocol';
import { openDatabase } from '../src/storage/database.js';
import {
  CanvasRepository,
  LayerRepository,
  SnapshotRepository,
} from '../src/paint/repository.js';
import { PaintService } from '../src/paint/service.js';
import { PaintEvents } from '../src/paint/events.js';
import { createObservability } from '../src/observability/index.js';
import { buildServer } from '../src/api/server.js';
import { fakeRuntime } from './helpers/fake-runtime.js';

const RED_CIRCLE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080"><circle cx="960" cy="540" r="120" fill="red"/></svg>';

interface SseClient {
  ready: Promise<void>;
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

function logs(app: FastifyInstance, category: AgentLog['category']): AgentLog[] {
  return app.observability.repository.query({ category, limit: 300 }).items;
}

async function waitForLog(
  app: FastifyInstance,
  category: AgentLog['category'],
  message: string,
  timeoutMs = 3000,
): Promise<AgentLog> {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const found = logs(app, category).find((log) => log.message === message);

    if (found) {
      return found;
    }

    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${category}/${message}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('trace passthrough: canvas-action 与 sse 归属到发起追踪', () => {
  it('一次 AI 工具调用里 tool_call / layer_create / sse_publish 共享同一 traceId，canvas-action 挂在 turn span 下', async () => {
    const app = buildServer({
      dbPath: ':memory:',
      runtime: fakeRuntime(async (input) => {
        await input.tools.execute(
          'canvas_create_layer',
          { canvasId: input.canvasId, name: 'AI — Red circle', svg: RED_CIRCLE_SVG },
          { canvasId: input.canvasId, prompt: input.userMessage ?? '', trace: input.trace },
        );
        input.onDelta('Done.');

        return { text: 'Done.', toolCallCount: 1 };
      }),
    });
    const baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });

    const canvasRes = await postJson(`${baseUrl}/paint/canvas`, {});
    const canvas = (await canvasRes.json()) as { id: string };

    const sse = connectSse(`${baseUrl}/paint/canvas/${canvas.id}/events`);
    await sse.ready;

    await postJson(`${baseUrl}/paint/ai/chat`, {
      message: '画一个红圈',
      canvasId: canvas.id,
    });

    const toolCall = await waitForLog(app, 'canvas-tool', 'tool_call');
    const layerCreate = await waitForLog(app, 'canvas-action', 'layer_create');
    const ssePublish = await waitForLog(app, 'sse', 'sse_publish');
    const codexTurn = await waitForLog(app, 'ai-chat', 'codex_turn');

    // 三条记录属于同一追踪。
    expect(toolCall.traceId).toBeTruthy();
    expect(toolCall.traceId).toBe(layerCreate.traceId);
    expect(layerCreate.traceId).toBe(ssePublish.traceId);

    // canvas-action 是发起它的 turn span 的子节点。
    expect(layerCreate.parentId).toBe(codexTurn.spanId);

    // 该追踪里能查到完整链路。
    const trace = app.observability.repository.findTrace(toolCall.traceId as string);
    const messages = trace.map((log) => log.message);
    expect(messages).toContain('tool_call');
    expect(messages).toContain('layer_create');
    expect(messages).toContain('sse_publish');

    sse.close();
    await app.close();
  });

  it('REST 直接写入（非 AI）的 canvas-action 与 sse_publish 归属到那次 HTTP 请求的追踪', async () => {
    const app = buildServer({ dbPath: ':memory:' });
    const baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });

    const canvasRes = await postJson(`${baseUrl}/paint/canvas`, {});
    const canvas = (await canvasRes.json()) as { id: string };

    const sse = connectSse(`${baseUrl}/paint/canvas/${canvas.id}/events`);
    await sse.ready;

    const res = await postJson(`${baseUrl}/paint/canvas/${canvas.id}/layers`, {
      name: 'REST stroke',
      type: 'vector',
      content: { kind: 'fabric', json: '{"type":"path","path":[]}' },
      expectedRevision: 0,
    });
    expect(res.status).toBe(201);

    const layerCreate = await waitForLog(app, 'canvas-action', 'layer_create');
    const ssePublish = await waitForLog(app, 'sse', 'sse_publish');

    // REST 写入不是 NULL trace。
    expect(layerCreate.traceId).toBeTruthy();
    expect(layerCreate.traceId).toBe(ssePublish.traceId);

    // 该 trace 里有一条 http_request 记录——即归属到那次 HTTP 请求。
    const trace = app.observability.repository.findTrace(layerCreate.traceId as string);
    const httpRequest = trace.find(
      (log) => log.category === 'http' && log.message === 'http_request',
    );
    expect(httpRequest).toBeDefined();

    sse.close();
    await app.close();
  });

  it('没有 trace 的调用方记录仍是 NULL trace（行为不变）', () => {
    const db = openDatabase(':memory:');
    const obs = createObservability(db);
    const service = new PaintService(
      new CanvasRepository(db),
      new LayerRepository(db),
      new SnapshotRepository(db),
      new PaintEvents(),
      obs.logger,
    );

    const canvas = service.createCanvas({ name: '无 trace' });
    service.applyAction(canvas.id, {
      actor: 'user',
      action: {
        type: 'canvas_create_layer',
        layer: {
          name: '裸调用图层',
          type: 'vector',
          content: { kind: 'fabric', json: '{"type":"path","path":[]}' },
        },
      },
    });

    const layerCreate = obs.repository
      .query({ category: 'canvas-action' })
      .items.find((log) => log.message === 'layer_create');

    expect(layerCreate).toBeDefined();
    expect(layerCreate?.traceId).toBeNull();
    expect(layerCreate?.parentId).toBeNull();

    db.close();
  });
});

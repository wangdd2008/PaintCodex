import { request as httpRequest } from 'node:http';
import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AgentLog, LogCategory } from '@paintcodex/protocol';
import { buildServer } from '../src/api/server.js';

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

function logs(app: FastifyInstance, category: LogCategory): AgentLog[] {
  return app.observability.repository.query({ category, limit: 200 }).items;
}

function canvasActionLogs(app: FastifyInstance): AgentLog[] {
  return logs(app, 'canvas-action');
}

async function createCanvas(
  app: FastifyInstance,
  payload: Record<string, unknown> = {},
): Promise<{ id: string; revision: number }> {
  const response = await app.inject({
    method: 'POST',
    url: '/paint/canvas',
    payload,
  });

  return response.json();
}

async function createLayer(
  app: FastifyInstance,
  canvasId: string,
  expectedRevision: number,
  actor?: 'user' | 'agent',
) {
  return app.inject({
    method: 'POST',
    url: `/paint/canvas/${canvasId}/layers`,
    payload: {
      name: 'Stroke',
      type: 'vector',
      content: { kind: 'fabric', json: '{"type":"path","path":[]}' },
      expectedRevision,
      ...(actor ? { actor } : {}),
    },
  });
}

async function applyAgentLayerCreate(
  app: FastifyInstance,
  canvasId: string,
  expectedRevision: number,
) {
  return app.inject({
    method: 'POST',
    url: `/paint/canvas/${canvasId}/apply-action`,
    payload: {
      actor: 'agent',
      expectedRevision,
      action: {
        type: 'canvas_create_layer',
        layer: {
          name: 'Agent stroke',
          type: 'vector',
          content: { kind: 'fabric', json: '{"type":"path","path":[]}' },
        },
      },
    },
  });
}

async function waitForLog(
  app: FastifyInstance,
  category: LogCategory,
  message: string,
  timeoutMs = 2000,
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

describe('canvas action instrumentation', () => {
  it('logs canvas creation once with actor and zero revision', async () => {
    const app = buildServer({ dbPath: ':memory:' });

    const canvas = await createCanvas(app, { name: 'Logged', width: 640, height: 480 });
    const canvasLogs = canvasActionLogs(app).filter(
      (log) => log.message === 'canvas_create',
    );

    expect(canvasLogs).toHaveLength(1);
    expect(canvasLogs[0]).toMatchObject({
      category: 'canvas-action',
      level: 'info',
      canvasId: canvas.id,
      revision: 0,
      actor: 'user',
      payload: { name: 'Logged', width: 640, height: 480 },
    });

    await app.close();
  });

  it('logs layer creation with the new revision, actor and layer id', async () => {
    const app = buildServer({ dbPath: ':memory:' });
    const canvas = await createCanvas(app);

    const response = await createLayer(app, canvas.id, 0);
    const layerId = response.json().layers[0].id as string;
    const layerLog = canvasActionLogs(app).find(
      (log) => log.message === 'layer_create',
    );

    expect(layerLog).toMatchObject({
      canvasId: canvas.id,
      revision: 1,
      actor: 'user',
      payload: { layerId, layerType: 'vector' },
    });

    await app.close();
  });

  it('records the requesting actor for apply-action mutations', async () => {
    const app = buildServer({ dbPath: ':memory:' });
    const canvas = await createCanvas(app);

    const response = await applyAgentLayerCreate(app, canvas.id, 0);
    const layerId = response.json().layers[0].id as string;
    const layerLog = canvasActionLogs(app).find(
      (log) => log.message === 'layer_create',
    );

    expect(layerLog).toMatchObject({
      canvasId: canvas.id,
      revision: 1,
      actor: 'agent',
      payload: { layerId, layerType: 'vector' },
    });

    await app.close();
  });

  it('logs layer updates and deletes', async () => {
    const app = buildServer({ dbPath: ':memory:' });
    const canvas = await createCanvas(app);
    const created = await createLayer(app, canvas.id, 0);
    const layerId = created.json().layers[0].id as string;

    const updated = await app.inject({
      method: 'PATCH',
      url: `/paint/canvas/${canvas.id}/layers/${layerId}`,
      payload: { visible: false, expectedRevision: 1 },
    });
    expect(updated.statusCode).toBe(200);

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/paint/canvas/${canvas.id}/layers/${layerId}?expectedRevision=2`,
    });
    expect(deleted.statusCode).toBe(200);

    const updateLog = canvasActionLogs(app).find(
      (log) => log.message === 'layer_update',
    );
    const deleteLog = canvasActionLogs(app).find(
      (log) => log.message === 'layer_delete',
    );

    expect(updateLog).toMatchObject({
      canvasId: canvas.id,
      revision: 2,
      actor: 'user',
      payload: { layerId },
    });
    expect(deleteLog).toMatchObject({
      canvasId: canvas.id,
      revision: 3,
      actor: 'user',
      payload: { layerId },
    });

    await app.close();
  });

  it('logs undo and redo with the restored revision', async () => {
    const app = buildServer({ dbPath: ':memory:' });
    const canvas = await createCanvas(app);

    await createLayer(app, canvas.id, 0);
    await createLayer(app, canvas.id, 1);

    const undone = await app.inject({
      method: 'POST',
      url: `/paint/canvas/${canvas.id}/undo`,
      payload: { expectedRevision: 2 },
    });
    expect(undone.statusCode).toBe(200);

    const redone = await app.inject({
      method: 'POST',
      url: `/paint/canvas/${canvas.id}/redo`,
      payload: { expectedRevision: 3 },
    });
    expect(redone.statusCode).toBe(200);

    const undoLog = canvasActionLogs(app).find((log) => log.message === 'undo');
    const redoLog = canvasActionLogs(app).find((log) => log.message === 'redo');

    expect(undoLog).toMatchObject({
      canvasId: canvas.id,
      revision: 3,
      actor: 'user',
      payload: { restoredRevision: 1 },
    });
    expect(redoLog).toMatchObject({
      canvasId: canvas.id,
      revision: 4,
      actor: 'user',
      payload: { restoredRevision: 2 },
    });

    await app.close();
  });
});

describe('SSE instrumentation', () => {
  it('logs subscribe, publish and disconnect without logging heartbeats', async () => {
    const app = buildServer({ dbPath: ':memory:' });
    const baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });
    const canvas = await createCanvas(app);
    const sse = connectSse(`${baseUrl}/paint/canvas/${canvas.id}/events`);

    await sse.ready;

    const subscribed = await waitForLog(app, 'sse', 'sse_subscribe');

    expect(subscribed).toMatchObject({
      level: 'info',
      canvasId: canvas.id,
      payload: { canvasId: canvas.id },
    });

    const response = await fetch(`${baseUrl}/paint/canvas/${canvas.id}/layers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Live stroke',
        type: 'vector',
        content: { kind: 'fabric', json: '{"type":"path","path":[]}' },
        expectedRevision: 0,
      }),
    });
    expect(response.status).toBe(201);

    await sse.waitFor((text) => text.includes('event: snapshot_changed'));
    const published = await waitForLog(app, 'sse', 'sse_publish');

    expect(published).toMatchObject({
      level: 'info',
      canvasId: canvas.id,
      payload: { event: 'snapshot_changed', revision: 1 },
    });

    sse.close();
    const disconnected = await waitForLog(app, 'sse', 'sse_disconnect');

    expect(disconnected).toMatchObject({
      level: 'info',
      canvasId: canvas.id,
    });
    expect(logs(app, 'sse').filter((log) => log.message === 'sse_ping')).toHaveLength(
      0,
    );

    await app.close();
  });
});

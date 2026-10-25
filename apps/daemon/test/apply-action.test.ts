import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/api/server.js';

const FABRIC_CONTENT = {
  kind: 'fabric' as const,
  json: '{"type":"path","path":[]}',
};

async function createCanvas(app: FastifyInstance): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/paint/canvas',
    payload: {},
  });

  return response.json().id as string;
}

async function createLayer(
  app: FastifyInstance,
  canvasId: string,
  name: string,
  expectedRevision?: number,
) {
  return app.inject({
    method: 'POST',
    url: `/paint/canvas/${canvasId}/layers`,
    payload: {
      name,
      type: 'vector',
      content: FABRIC_CONTENT,
      expectedRevision,
    },
  });
}

async function applyAction(
  app: FastifyInstance,
  canvasId: string,
  payload: unknown,
) {
  return app.inject({
    method: 'POST',
    url: `/paint/canvas/${canvasId}/apply-action`,
    payload,
  });
}

describe('apply-action validation', () => {
  it('rejects an unknown action without mutating the canvas', async () => {
    const app = buildServer({ dbPath: ':memory:' });
    const canvasId = await createCanvas(app);

    const response = await applyAction(app, canvasId, {
      actor: 'user',
      action: { type: 'not_a_real_action' },
    });
    const canvas = await app.inject({ method: 'GET', url: `/paint/canvas/${canvasId}` });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'invalid_action' } });
    expect(canvas.json()).toMatchObject({ revision: 0, layers: [] });

    await app.close();
  });

  it('rejects a create action without a layer payload', async () => {
    const app = buildServer({ dbPath: ':memory:' });
    const canvasId = await createCanvas(app);

    const response = await applyAction(app, canvasId, {
      actor: 'agent',
      action: { type: 'canvas_create_layer' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'invalid_action' } });

    await app.close();
  });

  it('does not truncate the redo branch on an invalid action', async () => {
    const app = buildServer({ dbPath: ':memory:' });
    const canvasId = await createCanvas(app);
    await createLayer(app, canvasId, 'A', 0);
    await createLayer(app, canvasId, 'B', 1);
    await app.inject({
      method: 'POST',
      url: `/paint/canvas/${canvasId}/undo`,
      payload: { expectedRevision: 2 },
    });

    const invalid = await applyAction(app, canvasId, {
      actor: 'user',
      action: { type: 'still_not_real' },
    });
    const redone = await app.inject({
      method: 'POST',
      url: `/paint/canvas/${canvasId}/redo`,
      payload: { expectedRevision: 3 },
    });

    expect(invalid.statusCode).toBe(400);
    expect(redone.statusCode).toBe(200);
    expect(redone.json()).toMatchObject({
      revision: 4,
      layers: [{ name: 'A' }, { name: 'B' }],
    });

    await app.close();
  });

  it('updates layer content through PATCH', async () => {
    const app = buildServer({ dbPath: ':memory:' });
    const canvasId = await createCanvas(app);
    const firstSvg = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="5"/></svg>';
    const secondSvg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="5" height="5"/></svg>';
    const created = await app.inject({
      method: 'POST',
      url: `/paint/canvas/${canvasId}/layers`,
      payload: {
        name: 'AI layer',
        type: 'ai-generated',
        content: { kind: 'svg', svg: firstSvg },
        expectedRevision: 0,
      },
    });
    const layerId = created.json().layers[0].id as string;

    const response = await app.inject({
      method: 'PATCH',
      url: `/paint/canvas/${canvasId}/layers/${layerId}`,
      payload: {
        content: { kind: 'svg', svg: secondSvg },
        expectedRevision: 1,
      },
    });
    const fetched = await app.inject({ method: 'GET', url: `/paint/canvas/${canvasId}` });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      revision: 2,
      layers: [{ id: layerId, content: { kind: 'svg', svg: secondSvg } }],
    });
    expect(fetched.json().layers[0].content).toEqual({ kind: 'svg', svg: secondSvg });

    await app.close();
  });

  it('rejects malformed layer content patches', async () => {
    const app = buildServer({ dbPath: ':memory:' });
    const canvasId = await createCanvas(app);
    const created = await createLayer(app, canvasId, 'A', 0);
    const layerId = created.json().layers[0].id as string;

    const response = await app.inject({
      method: 'PATCH',
      url: `/paint/canvas/${canvasId}/layers/${layerId}`,
      payload: { content: { kind: 'exe', data: 'x' }, expectedRevision: 1 },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'invalid_layer' } });

    await app.close();
  });
});

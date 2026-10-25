import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/api/server.js';

async function createCanvas(app: FastifyInstance, name = 'History'): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/paint/canvas',
    payload: { name },
  });

  return response.json().id as string;
}

async function createStroke(
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
      content: { kind: 'fabric', json: '{"type":"path","path":[]}' },
      expectedRevision,
    },
  });
}

async function undo(app: FastifyInstance, canvasId: string, expectedRevision?: number) {
  return app.inject({
    method: 'POST',
    url: `/paint/canvas/${canvasId}/undo`,
    payload: { expectedRevision },
  });
}

async function redo(app: FastifyInstance, canvasId: string, expectedRevision?: number) {
  return app.inject({
    method: 'POST',
    url: `/paint/canvas/${canvasId}/redo`,
    payload: { expectedRevision },
  });
}

describe('snapshot undo/redo', () => {
  it('starts with no undo or redo available', async () => {
    const app = buildServer({ dbPath: ':memory:' });
    const canvasId = await createCanvas(app);
    const response = await app.inject({ method: 'GET', url: `/paint/canvas/${canvasId}` });

    expect(response.json().history).toEqual({ canUndo: false, canRedo: false });
    await app.close();
  });

  it('undoes layer creation and restores earlier layer sets', async () => {
    const app = buildServer({ dbPath: ':memory:' });
    const canvasId = await createCanvas(app);

    await createStroke(app, canvasId, 'A', 0);
    await createStroke(app, canvasId, 'B', 1);

    const firstUndo = await undo(app, canvasId, 2);
    expect(firstUndo.statusCode).toBe(200);
    expect(firstUndo.json()).toMatchObject({
      revision: 3,
      layers: [{ name: 'A' }],
      history: { canUndo: true, canRedo: true },
    });

    const secondUndo = await undo(app, canvasId, 3);
    expect(secondUndo.json()).toMatchObject({
      revision: 4,
      layers: [],
      history: { canUndo: false, canRedo: true },
    });

    const exhausted = await undo(app, canvasId, 4);
    expect(exhausted.statusCode).toBe(409);
    expect(exhausted.json()).toMatchObject({ error: { code: 'nothing_to_undo' } });

    await app.close();
  });

  it('redoes the undone layer', async () => {
    const app = buildServer({ dbPath: ':memory:' });
    const canvasId = await createCanvas(app);
    await createStroke(app, canvasId, 'A', 0);
    await createStroke(app, canvasId, 'B', 1);
    await undo(app, canvasId, 2);

    const response = await redo(app, canvasId, 3);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      revision: 4,
      layers: [{ name: 'A' }, { name: 'B' }],
      history: { canUndo: true, canRedo: false },
    });

    await app.close();
  });

  it('discards the redo branch when a new change follows an undo', async () => {
    const app = buildServer({ dbPath: ':memory:' });
    const canvasId = await createCanvas(app);
    await createStroke(app, canvasId, 'A', 0);
    await createStroke(app, canvasId, 'B', 1);
    const undone = await undo(app, canvasId, 2);

    await createStroke(app, canvasId, 'C', undone.json().revision);

    const response = await app.inject({ method: 'GET', url: `/paint/canvas/${canvasId}` });
    expect(response.json()).toMatchObject({
      layers: [{ name: 'A' }, { name: 'C' }],
      history: { canUndo: true, canRedo: false },
    });

    const missingRedo = await redo(app, canvasId, response.json().revision);
    expect(missingRedo.statusCode).toBe(409);
    expect(missingRedo.json()).toMatchObject({ error: { code: 'nothing_to_redo' } });

    await app.close();
  });

  it('restores layer properties such as visibility', async () => {
    const app = buildServer({ dbPath: ':memory:' });
    const canvasId = await createCanvas(app);
    const created = await createStroke(app, canvasId, 'A', 0);
    const layerId = created.json().layers[0].id as string;

    await app.inject({
      method: 'PATCH',
      url: `/paint/canvas/${canvasId}/layers/${layerId}`,
      payload: { visible: false, expectedRevision: 1 },
    });

    const response = await undo(app, canvasId, 2);

    expect(response.json()).toMatchObject({
      revision: 3,
      layers: [{ id: layerId, visible: true }],
    });

    await app.close();
  });

  it('keeps only the most recent 20 snapshots per canvas', async () => {
    const app = buildServer({ dbPath: ':memory:' });
    const canvasId = await createCanvas(app);

    for (let index = 0; index < 21; index += 1) {
      const created = await createStroke(app, canvasId, `Stroke ${index}`, index);
      expect(created.statusCode).toBe(201);
    }

    let revision = 21;

    for (let index = 0; index < 19; index += 1) {
      const undone = await undo(app, canvasId, revision);
      expect(undone.statusCode).toBe(200);
      revision = undone.json().revision;
    }

    const exhausted = await undo(app, canvasId, revision);
    expect(exhausted.statusCode).toBe(409);
    expect(exhausted.json()).toMatchObject({ error: { code: 'nothing_to_undo' } });

    await app.close();
  });

  it('returns 404 for undo and redo on a missing canvas', async () => {
    const app = buildServer({ dbPath: ':memory:' });

    expect((await undo(app, 'missing')).statusCode).toBe(404);
    expect((await redo(app, 'missing')).statusCode).toBe(404);

    await app.close();
  });
});

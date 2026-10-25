import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/api/server.js';

const tempDirs: string[] = [];

const strokeContent = {
  kind: 'fabric' as const,
  json: JSON.stringify({ type: 'path', path: [] }),
};

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

async function createCanvas(app: FastifyInstance, name = 'Test'): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/paint/canvas',
    payload: { name },
  });

  return response.json().id as string;
}

function createLayerPayload(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Stroke 1',
    type: 'vector',
    content: strokeContent,
    ...overrides,
  };
}

describe('layer API', () => {
  it('creates a layer and bumps the canvas revision', async () => {
    const app = buildServer({ dbPath: ':memory:' });
    const canvasId = await createCanvas(app);

    const response = await app.inject({
      method: 'POST',
      url: `/paint/canvas/${canvasId}/layers`,
      payload: createLayerPayload({ expectedRevision: 0 }),
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body).toMatchObject({ id: canvasId, revision: 1 });
    expect(body.layers).toHaveLength(1);
    expect(body.layers[0]).toMatchObject({
      canvasId,
      name: 'Stroke 1',
      type: 'vector',
      zIndex: 0,
      visible: true,
      opacity: 1,
      content: strokeContent,
      metadata: { createdBy: 'user' },
    });

    await app.close();
  });

  it('rejects a stale expectedRevision with 409', async () => {
    const app = buildServer({ dbPath: ':memory:' });
    const canvasId = await createCanvas(app);
    await app.inject({
      method: 'POST',
      url: `/paint/canvas/${canvasId}/layers`,
      payload: createLayerPayload({ expectedRevision: 0 }),
    });

    const response = await app.inject({
      method: 'POST',
      url: `/paint/canvas/${canvasId}/layers`,
      payload: createLayerPayload({ name: 'Stroke 2', expectedRevision: 0 }),
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: { code: 'revision_conflict' },
      currentRevision: 1,
    });

    await app.close();
  });

  it('returns layers in zIndex order', async () => {
    const app = buildServer({ dbPath: ':memory:' });
    const canvasId = await createCanvas(app);

    await app.inject({
      method: 'POST',
      url: `/paint/canvas/${canvasId}/layers`,
      payload: createLayerPayload({ name: 'Bottom' }),
    });
    await app.inject({
      method: 'POST',
      url: `/paint/canvas/${canvasId}/layers`,
      payload: createLayerPayload({ name: 'Top' }),
    });

    const response = await app.inject({ method: 'GET', url: `/paint/canvas/${canvasId}` });
    const body = response.json();

    expect(body.layers.map((layer: { name: string }) => layer.name)).toEqual(['Bottom', 'Top']);
    expect(body.revision).toBe(2);

    await app.close();
  });

  it('updates a layer and bumps the revision', async () => {
    const app = buildServer({ dbPath: ':memory:' });
    const canvasId = await createCanvas(app);
    const created = await app.inject({
      method: 'POST',
      url: `/paint/canvas/${canvasId}/layers`,
      payload: createLayerPayload({ expectedRevision: 0 }),
    });
    const layerId = created.json().layers[0].id as string;

    const response = await app.inject({
      method: 'PATCH',
      url: `/paint/canvas/${canvasId}/layers/${layerId}`,
      payload: { visible: false, expectedRevision: 1 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      revision: 2,
      layers: [{ id: layerId, visible: false }],
    });

    await app.close();
  });

  it('deletes a layer and bumps the revision', async () => {
    const app = buildServer({ dbPath: ':memory:' });
    const canvasId = await createCanvas(app);
    const created = await app.inject({
      method: 'POST',
      url: `/paint/canvas/${canvasId}/layers`,
      payload: createLayerPayload({ expectedRevision: 0 }),
    });
    const layerId = created.json().layers[0].id as string;

    const response = await app.inject({
      method: 'DELETE',
      url: `/paint/canvas/${canvasId}/layers/${layerId}?expectedRevision=1`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ revision: 2, layers: [] });

    await app.close();
  });

  it('applies an agent action through the same dispatcher', async () => {
    const app = buildServer({ dbPath: ':memory:' });
    const canvasId = await createCanvas(app);

    const response = await app.inject({
      method: 'POST',
      url: `/paint/canvas/${canvasId}/apply-action`,
      payload: {
        actor: 'agent',
        expectedRevision: 0,
        action: {
          type: 'canvas_create_layer',
          layer: {
            name: 'AI circle',
            type: 'ai-generated',
            content: { kind: 'svg', svg: '<svg><circle cx="10" cy="10" r="5" /></svg>' },
          },
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      revision: 1,
      layers: [
        {
          name: 'AI circle',
          type: 'ai-generated',
          metadata: { createdBy: 'agent' },
        },
      ],
    });

    await app.close();
  });

  it('keeps layers after the daemon restarts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'paintcodex-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'paintcodex.db');

    const first = buildServer({ dbPath });
    const canvasId = await createCanvas(first, 'Persisted layers');
    await first.inject({
      method: 'POST',
      url: `/paint/canvas/${canvasId}/layers`,
      payload: createLayerPayload({ name: 'Survives' }),
    });
    await first.close();

    const second = buildServer({ dbPath });
    const response = await second.inject({ method: 'GET', url: `/paint/canvas/${canvasId}` });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      layers: [{ name: 'Survives', content: strokeContent }],
    });
    await second.close();
  });

  it('returns 404 for a missing canvas or layer', async () => {
    const app = buildServer({ dbPath: ':memory:' });

    const missingCanvas = await app.inject({
      method: 'POST',
      url: '/paint/canvas/missing/layers',
      payload: createLayerPayload(),
    });
    expect(missingCanvas.statusCode).toBe(404);
    expect(missingCanvas.json()).toMatchObject({ error: { code: 'canvas_not_found' } });

    const canvasId = await createCanvas(app);
    const missingLayer = await app.inject({
      method: 'PATCH',
      url: `/paint/canvas/${canvasId}/layers/missing`,
      payload: { visible: false },
    });
    expect(missingLayer.statusCode).toBe(404);
    expect(missingLayer.json()).toMatchObject({ error: { code: 'layer_not_found' } });

    await app.close();
  });
});

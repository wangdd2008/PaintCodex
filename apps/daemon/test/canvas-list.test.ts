import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/api/server.js';

const strokeContent = {
  kind: 'fabric' as const,
  json: JSON.stringify({ type: 'path', path: [] }),
};

async function createCanvas(app: FastifyInstance, name = 'Listed'): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/paint/canvas',
    payload: { name },
  });

  return response.json().id as string;
}

async function addLayer(app: FastifyInstance, canvasId: string): Promise<void> {
  await app.inject({
    method: 'POST',
    url: `/paint/canvas/${canvasId}/layers`,
    payload: { name: 'Stroke', type: 'vector', content: strokeContent },
  });
}

describe('canvas list API', () => {
  it('returns an empty page when no canvas exists', async () => {
    const app = buildServer({ dbPath: ':memory:' });

    const response = await app.inject({ method: 'GET', url: '/paint/canvas' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [], total: 0, limit: 50, offset: 0 });

    await app.close();
  });

  it('reports each summary with its real layer count and a thumbnail marker', async () => {
    const app = buildServer({ dbPath: ':memory:' });
    const alphaId = await createCanvas(app, 'Alpha');
    await addLayer(app, alphaId);
    await addLayer(app, alphaId);
    const betaId = await createCanvas(app, 'Beta');

    const response = await app.inject({ method: 'GET', url: '/paint/canvas' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.total).toBe(2);
    expect(body.limit).toBe(50);
    expect(body.offset).toBe(0);

    const byId = new Map(body.items.map((item: { id: string }) => [item.id, item]));
    const alpha = byId.get(alphaId);
    const beta = byId.get(betaId);

    expect(alpha).toMatchObject({
      name: 'Alpha',
      layerCount: 2,
      revision: 2,
      hasThumbnail: false,
      thumbnailRevision: null,
    });
    expect(alpha).toEqual(
      expect.objectContaining({
        width: expect.any(Number),
        height: expect.any(Number),
        backgroundColor: expect.any(String),
        createdAt: expect.any(Number),
        updatedAt: expect.any(Number),
      }),
    );
    // The list must not leak thumbnail bytes.
    expect(alpha).not.toHaveProperty('bytes');

    expect(beta).toMatchObject({
      name: 'Beta',
      layerCount: 0,
      hasThumbnail: false,
      thumbnailRevision: null,
    });

    await app.close();
  });

  it('rejects an unknown sort with 400 and orders by the chosen timestamp', async () => {
    const app = buildServer({ dbPath: ':memory:' });
    const firstId = await createCanvas(app, 'First');
    const secondId = await createCanvas(app, 'Second');

    const bad = await app.inject({ method: 'GET', url: '/paint/canvas?sort=name' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ error: { code: 'invalid_query' } });

    // sort=created：后创建的排在前面。
    const created = await app.inject({ method: 'GET', url: '/paint/canvas?sort=created' });
    expect(created.statusCode).toBe(200);
    expect(created.json().items.map((item: { id: string }) => item.id)).toEqual([secondId, firstId]);

    // 改名 bump First 的 updatedAt 后，默认（updated）排序把它顶到最前。
    await app.inject({
      method: 'PATCH',
      url: `/paint/canvas/${firstId}`,
      payload: { name: 'First' },
    });
    const updated = await app.inject({ method: 'GET', url: '/paint/canvas' });
    expect(updated.json().items.map((item: { id: string }) => item.id)).toEqual([firstId, secondId]);

    await app.close();
  });

  it('validates pagination bounds and keeps total independent of the page', async () => {
    const app = buildServer({ dbPath: ':memory:' });
    for (let i = 0; i < 5; i++) {
      await createCanvas(app, `C${i}`);
    }

    for (const badQuery of ['limit=0', 'limit=101', 'limit=abc', 'offset=-1']) {
      const response = await app.inject({ method: 'GET', url: `/paint/canvas?${badQuery}` });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: { code: 'invalid_query' } });
    }

    const first = await app.inject({ method: 'GET', url: '/paint/canvas?limit=2&offset=0' });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ limit: 2, offset: 0, total: 5 });
    expect(first.json().items).toHaveLength(2);

    const second = await app.inject({ method: 'GET', url: '/paint/canvas?limit=2&offset=2' });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ limit: 2, offset: 2, total: 5 });
    expect(second.json().items).toHaveLength(2);

    // Offset past the last row: an empty page, but total still counts the whole library.
    const tail = await app.inject({ method: 'GET', url: '/paint/canvas?limit=2&offset=10' });
    expect(tail.statusCode).toBe(200);
    expect(tail.json()).toMatchObject({ limit: 2, offset: 10, total: 5, items: [] });

    await app.close();
  });
});

import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/api/server.js';

/** 1×1 透明 PNG，base64 编码后仍可解码出合法 IHDR 宽高。 */
const ONE_PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

const DATA_URL = `data:image/png;base64,${ONE_PIXEL_PNG_BASE64}`;

async function createCanvas(app: ReturnType<typeof buildServer>): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/paint/canvas',
    payload: { name: '缩略图画布' },
  });

  return res.json().id as string;
}

describe('canvas thumbnail API', () => {
  it('stores a PUT thumbnail and returns it on GET', async () => {
    const app = buildServer({ dbPath: ':memory:' });
    const id = await createCanvas(app);

    const put = await app.inject({
      method: 'PUT',
      url: `/paint/canvas/${id}/thumbnail`,
      payload: { imageUrl: DATA_URL, revision: 3 },
    });

    expect(put.statusCode).toBe(204);
    expect(put.body).toBe('');

    const get = await app.inject({ method: 'GET', url: `/paint/canvas/${id}/thumbnail` });

    expect(get.statusCode).toBe(200);
    expect(get.headers['content-type']).toContain('image/png');
    expect(get.headers['cache-control']).toBe('no-store');
    expect(get.rawPayload).toEqual(Buffer.from(ONE_PIXEL_PNG_BASE64, 'base64'));

    await app.close();
  });

  it('rejects a non png data url with 400 invalid_thumbnail', async () => {
    const app = buildServer({ dbPath: ':memory:' });
    const id = await createCanvas(app);

    const res = await app.inject({
      method: 'PUT',
      url: `/paint/canvas/${id}/thumbnail`,
      payload: { imageUrl: 'data:image/jpeg;base64,/9j/4AAQ', revision: 0 },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('invalid_thumbnail');

    await app.close();
  });

  it('rejects a decoded payload larger than 256 KB with 400', async () => {
    const app = buildServer({ dbPath: ':memory:' });
    const id = await createCanvas(app);
    // 解码后 300 KB，超过 256 KB 上限。
    const oversized = `data:image/png;base64,${Buffer.alloc(300_000).toString('base64')}`;

    const res = await app.inject({
      method: 'PUT',
      url: `/paint/canvas/${id}/thumbnail`,
      payload: { imageUrl: oversized, revision: 0 },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('invalid_thumbnail');

    await app.close();
  });

  it('rejects a non-integer revision with 400', async () => {
    const app = buildServer({ dbPath: ':memory:' });
    const id = await createCanvas(app);

    const res = await app.inject({
      method: 'PUT',
      url: `/paint/canvas/${id}/thumbnail`,
      payload: { imageUrl: DATA_URL, revision: 2.5 },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('invalid_thumbnail');

    await app.close();
  });

  it('returns 404 canvas_not_found when putting to an unknown canvas', async () => {
    const app = buildServer({ dbPath: ':memory:' });

    const res = await app.inject({
      method: 'PUT',
      url: '/paint/canvas/does-not-exist/thumbnail',
      payload: { imageUrl: DATA_URL, revision: 0 },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('canvas_not_found');

    await app.close();
  });

  it('returns 404 thumbnail_not_found when the canvas has no thumbnail yet', async () => {
    const app = buildServer({ dbPath: ':memory:' });
    const id = await createCanvas(app);

    const res = await app.inject({ method: 'GET', url: `/paint/canvas/${id}/thumbnail` });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('thumbnail_not_found');

    await app.close();
  });

  it('overwrites an existing thumbnail on a second PUT', async () => {
    const app = buildServer({ dbPath: ':memory:' });
    const id = await createCanvas(app);
    const second = `data:image/png;base64,${Buffer.alloc(64, 0x7f).toString('base64')}`;

    await app.inject({
      method: 'PUT',
      url: `/paint/canvas/${id}/thumbnail`,
      payload: { imageUrl: DATA_URL, revision: 1 },
    });
    const put2 = await app.inject({
      method: 'PUT',
      url: `/paint/canvas/${id}/thumbnail`,
      payload: { imageUrl: second, revision: 2 },
    });

    expect(put2.statusCode).toBe(204);

    const get = await app.inject({ method: 'GET', url: `/paint/canvas/${id}/thumbnail` });
    expect(get.statusCode).toBe(200);
    expect(get.rawPayload).toEqual(Buffer.from(second.slice('data:image/png;base64,'.length), 'base64'));

    await app.close();
  });
});

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/api/server.js';

const tempDirs: string[] = [];

function newDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'paintcodex-'));
  tempDirs.push(dir);
  return join(dir, 'paintcodex.db');
}

/** Mirrors the documented default-name format with the local wall clock. */
function localMinuteStamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');

  return `未命名 ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe('canvas API', () => {
  it('creates a 1920x1080 white canvas at revision 0', async () => {
    const app = buildServer({ dbPath: ':memory:' });
    const before = localMinuteStamp(new Date());

    const response = await app.inject({
      method: 'POST',
      url: '/paint/canvas',
      payload: {},
    });
    const after = localMinuteStamp(new Date());

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      width: 1920,
      height: 1080,
      backgroundColor: '#ffffff',
      revision: 0,
      layers: [],
    });
    expect(response.json().id).toEqual(expect.any(String));

    // 默认名是「未命名 YYYY-MM-DD HH:mm」，用 daemon 本地时区，且不是裸 Untitled。
    expect(response.json().name).toMatch(/^未命名 \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect([before, after]).toContain(response.json().name);

    await app.close();
  });

  it('honours an explicit canvas name and size', async () => {
    const app = buildServer({ dbPath: ':memory:' });

    const response = await app.inject({
      method: 'POST',
      url: '/paint/canvas',
      payload: { name: 'Study', width: 800, height: 600, backgroundColor: '#101010' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      name: 'Study',
      width: 800,
      height: 600,
      backgroundColor: '#101010',
    });

    await app.close();
  });

  it('returns a created canvas by id', async () => {
    const app = buildServer({ dbPath: ':memory:' });
    const created = await app.inject({
      method: 'POST',
      url: '/paint/canvas',
      payload: { name: 'Lookup' },
    });
    const { id } = created.json();

    const response = await app.inject({ method: 'GET', url: `/paint/canvas/${id}` });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id, name: 'Lookup', layers: [] });

    await app.close();
  });

  it('returns a structured 404 for an unknown canvas', async () => {
    const app = buildServer({ dbPath: ':memory:' });

    const response = await app.inject({ method: 'GET', url: '/paint/canvas/missing' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: 'canvas_not_found', message: '画布不存在' },
    });

    await app.close();
  });

  it('keeps a canvas after the daemon restarts', async () => {
    const dbPath = newDbPath();
    const first = buildServer({ dbPath });
    const created = await first.inject({
      method: 'POST',
      url: '/paint/canvas',
      payload: { name: 'Persisted' },
    });
    const { id } = created.json();
    await first.close();

    const second = buildServer({ dbPath });
    const response = await second.inject({ method: 'GET', url: `/paint/canvas/${id}` });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id, name: 'Persisted' });
    await second.close();
  });
});

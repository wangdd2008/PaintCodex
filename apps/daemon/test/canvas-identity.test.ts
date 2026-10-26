import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_CANVAS_NAME_LENGTH } from '@paintcodex/protocol';
import { buildServer } from '../src/api/server.js';

const tempDirs: string[] = [];

function newDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'paintcodex-'));
  tempDirs.push(dir);
  return join(dir, 'paintcodex.db');
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

async function createCanvas(
  app: FastifyInstance,
  payload: Record<string, unknown> = {},
): Promise<{ id: string; name: string }> {
  const response = await app.inject({
    method: 'POST',
    url: '/paint/canvas',
    payload,
  });

  expect(response.statusCode).toBe(201);

  return response.json() as { id: string; name: string };
}

describe('POST /paint/canvas 名称校验', () => {
  it.each([
    ['数字', 123],
    ['布尔值', true],
    ['对象', { text: 'x' }],
    ['空串', ''],
    ['纯空白', '   '],
    ['超长', '名'.repeat(MAX_CANVAS_NAME_LENGTH + 1)],
  ])('%s → 400，不再 500', async (_label, name) => {
    const app = buildServer({ dbPath: ':memory:' });

    const response = await app.inject({
      method: 'POST',
      url: '/paint/canvas',
      payload: { name },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('invalid_canvas');

    await app.close();
  });

  it('接受 80 字符并去除首尾空白', async () => {
    const app = buildServer({ dbPath: ':memory:' });
    const longest = '画'.repeat(MAX_CANVAS_NAME_LENGTH);

    const trimmed = await createCanvas(app, { name: '  红色练习  ' });
    expect(trimmed.name).toBe('红色练习');

    const boundary = await createCanvas(app, { name: longest });
    expect(boundary.name).toBe(longest);

    await app.close();
  });
});

describe('PATCH /paint/canvas/:id', () => {
  it('只改 name，返回与 GET 同形的画布文档并保留图层与修订号', async () => {
    const app = buildServer({ dbPath: ':memory:' });
    const { id } = await createCanvas(app, { name: '未命名画布' });

    const layerResponse = await app.inject({
      method: 'POST',
      url: `/paint/canvas/${id}/layers`,
      payload: {
        name: '笔迹 1',
        type: 'vector',
        content: { kind: 'fabric', json: '{"type":"path"}' },
      },
    });
    expect(layerResponse.statusCode).toBe(201);
    const before = layerResponse.json();

    const response = await app.inject({
      method: 'PATCH',
      url: `/paint/canvas/${id}`,
      payload: { name: '  红色练习  ' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id,
      name: '红色练习',
      revision: before.revision,
      history: before.history,
    });
    expect(response.json().layers).toHaveLength(1);

    // 形状与 GET 一致：同样的字段集合，可直接替换本地文档。
    const fetched = await app.inject({ method: 'GET', url: `/paint/canvas/${id}` });
    expect(Object.keys(response.json()).sort()).toEqual(Object.keys(fetched.json()).sort());
    expect(fetched.json().name).toBe('红色练习');

    await app.close();
  });

  it('改名不推进修订号，也不破坏撤销栈', async () => {
    const app = buildServer({ dbPath: ':memory:' });
    const { id } = await createCanvas(app);

    await app.inject({
      method: 'POST',
      url: `/paint/canvas/${id}/layers`,
      payload: {
        name: '笔迹 1',
        type: 'vector',
        content: { kind: 'fabric', json: '{"type":"path"}' },
      },
    });

    const renamed = await app.inject({
      method: 'PATCH',
      url: `/paint/canvas/${id}`,
      payload: { name: '第一张' },
    });

    expect(renamed.json().revision).toBe(1);

    const undone = await app.inject({ method: 'POST', url: `/paint/canvas/${id}/undo` });
    expect(undone.statusCode).toBe(200);
    expect(undone.json().layers).toHaveLength(0);
    // 撤销只回退内容，名字属于身份，不随内容回退。
    expect(undone.json().name).toBe('第一张');

    await app.close();
  });

  it('改名在 daemon 重启后仍在', async () => {
    const dbPath = newDbPath();
    const first = buildServer({ dbPath });
    const { id } = await createCanvas(first);

    await first.inject({
      method: 'PATCH',
      url: `/paint/canvas/${id}`,
      payload: { name: '持久名' },
    });
    await first.close();

    const second = buildServer({ dbPath });
    const response = await second.inject({ method: 'GET', url: `/paint/canvas/${id}` });

    expect(response.json().name).toBe('持久名');
    await second.close();
  });

  it.each([
    ['width', { name: '合法名', width: 800 }],
    ['height', { name: '合法名', height: 600 }],
    ['仅 width', { width: 800 }],
    ['backgroundColor', { name: '合法名', backgroundColor: '#000000' }],
    ['未知字段', { name: '合法名', revision: 99 }],
    ['缺少 name', {}],
    ['空名', { name: '' }],
    ['纯空白名', { name: '  ' }],
    ['非字符串名', { name: 42 }],
    ['超长名', { name: '名'.repeat(MAX_CANVAS_NAME_LENGTH + 1) }],
  ])('%s → 400', async (_label, payload) => {
    const app = buildServer({ dbPath: ':memory:' });
    const { id } = await createCanvas(app);

    const response = await app.inject({
      method: 'PATCH',
      url: `/paint/canvas/${id}`,
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('invalid_canvas');

    // 校验失败不得写入：名字仍是原来的。
    const fetched = await app.inject({ method: 'GET', url: `/paint/canvas/${id}` });
    expect(fetched.json().name).not.toBe('合法名');

    await app.close();
  });

  it('不存在的画布 → 404', async () => {
    const app = buildServer({ dbPath: ':memory:' });

    const response = await app.inject({
      method: 'PATCH',
      url: '/paint/canvas/missing',
      payload: { name: '新名字' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: 'canvas_not_found', message: '画布不存在' },
    });

    await app.close();
  });
});

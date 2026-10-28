import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/api/server.js';
import type { CodexRuntime } from '../src/paint/agent/runtime/codex-runtime.js';
import { openDatabase } from '../src/storage/database.js';
import { fakeRuntime } from './helpers/fake-runtime.js';

const tempDirs: string[] = [];

function newDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'paintcodex-delete-'));
  tempDirs.push(dir);
  return join(dir, 'paintcodex.db');
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

/** 直接按主键数行；canvases 用 id，其余子表用 canvasId。 */
function rowCount(
  db: ReturnType<typeof openDatabase>,
  table: string,
  canvasId: string,
): number {
  const column = table === 'canvases' ? 'id' : 'canvasId';
  const row = db
    .prepare<[string], { n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`)
    .get(canvasId);

  return row!.n;
}

describe('DELETE /paint/canvas/:id', () => {
  it('returns a structured 404 for an unknown canvas', async () => {
    const app = buildServer({ dbPath: ':memory:' });

    const response = await app.inject({ method: 'DELETE', url: '/paint/canvas/missing' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: 'canvas_not_found', message: '画布不存在' },
    });

    await app.close();
  });

  it('deletes a canvas with 204 and then GET returns 404', async () => {
    const app = buildServer({ dbPath: ':memory:' });
    const created = await app.inject({
      method: 'POST',
      url: '/paint/canvas',
      payload: { name: 'Trash' },
    });
    const { id } = created.json();

    const response = await app.inject({ method: 'DELETE', url: `/paint/canvas/${id}` });

    expect(response.statusCode).toBe(204);
    expect(response.payload).toBe('');

    const after = await app.inject({ method: 'GET', url: `/paint/canvas/${id}` });
    expect(after.statusCode).toBe(404);

    await app.close();
  });

  it('cascades layers, snapshots and canvas_thumbnails rows to zero', async () => {
    const dbPath = newDbPath();
    const app = buildServer({ dbPath });
    const created = await app.inject({
      method: 'POST',
      url: '/paint/canvas',
      payload: { name: 'Cascade' },
    });
    const { id } = created.json();

    // 造一行图层（service 会顺带写一条 snapshot）
    await app.inject({
      method: 'POST',
      url: `/paint/canvas/${id}/layers`,
      payload: { name: 'L1', type: 'vector', content: { kind: 'svg', svg: '<svg></svg>' } },
    });
    // 直接写一行缩略图（票 03 之前没有接口，测试自己铺数据）
    const probe = openDatabase(dbPath);
    probe.prepare(
      `INSERT INTO canvas_thumbnails (canvasId, revision, width, height, bytes, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, 1, 320, 180, Buffer.from('thumb'), Date.now());

    // 删之前确有可级联的行，避免「本来就是空的」假通过
    expect(rowCount(probe, 'layers', id)).toBeGreaterThan(0);
    expect(rowCount(probe, 'snapshots', id)).toBeGreaterThan(0);
    expect(rowCount(probe, 'canvas_thumbnails', id)).toBe(1);
    probe.close();

    const response = await app.inject({ method: 'DELETE', url: `/paint/canvas/${id}` });
    expect(response.statusCode).toBe(204);
    await app.close();

    const check = openDatabase(dbPath);
    expect(rowCount(check, 'canvases', id)).toBe(0);
    expect(rowCount(check, 'layers', id)).toBe(0);
    expect(rowCount(check, 'snapshots', id)).toBe(0);
    expect(rowCount(check, 'canvas_thumbnails', id)).toBe(0);
    check.close();
  });

  it('still returns 204 when deleteThread throws, and logs a warn', async () => {
    const runtime = fakeRuntime(async () => ({ text: '', toolCallCount: 0 }));
    runtime.deleteThread = async () => {
      throw new Error('app-server gone');
    };
    const dbPath = newDbPath();
    const app = buildServer({ runtime, dbPath });
    const created = await app.inject({
      method: 'POST',
      url: '/paint/canvas',
      payload: { name: 'ThreadFails' },
    });
    const { id } = created.json();

    const response = await app.inject({ method: 'DELETE', url: `/paint/canvas/${id}` });

    // 不回滚删除：仍然 204
    expect(response.statusCode).toBe(204);
    await app.close();

    const check = openDatabase(dbPath);
    // 画布确实已被硬删
    expect(rowCount(check, 'canvases', id)).toBe(0);
    const failLog = check
      .prepare<[string], { n: number }>(
        `SELECT COUNT(*) AS n FROM agent_logs
         WHERE category = 'codex-runtime'
           AND message = 'thread_delete_failed'
           AND level = 'warn'
           AND canvas_id = ?`,
      )
      .get(id);
    expect(failLog!.n).toBe(1);
    check.close();
  });
});

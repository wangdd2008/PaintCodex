import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/storage/database.js';

/**
 * 造一个「旧版」数据库：agent_logs 表还没有 source/target 列，
 * 并塞进各分类的历史行，模拟升级前的真实状态。
 */
function createOldSchemaDb(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pc-log-migrate-'));
  const path = join(dir, 'old.db');

  const db = new Database(path);
  db.exec(`
    CREATE TABLE agent_logs (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      trace_id      TEXT,
      span_id       TEXT,
      parent_id     TEXT,
      timestamp     INTEGER NOT NULL,
      level         TEXT,
      category      TEXT NOT NULL,
      message       TEXT NOT NULL,
      payload       TEXT,
      duration_ms   INTEGER,
      error         TEXT,
      canvas_id     TEXT,
      revision      INTEGER,
      actor         TEXT
    );
  `);

  const insert = db.prepare(
    `INSERT INTO agent_logs (timestamp, level, category, message) VALUES (?, ?, ?, ?)`,
  );
  insert.run(1, 'info', 'http', 'http_request');
  insert.run(2, 'info', 'http', 'http_request');
  insert.run(3, 'info', 'sse', 'sse_publish');
  insert.run(4, 'info', 'codex-runtime', 'turn_complete');
  insert.run(5, 'info', 'canvas-action', 'layer_create');
  insert.run(6, 'info', 'system', 'startup');
  db.close();

  return path;
}

describe('agent_logs 方向列迁移', () => {
  it('新增 source/target 列，且只回填 http 与 sse', () => {
    const db = openDatabase(createOldSchemaDb());

    const rows = db
      .prepare(
        `SELECT category, message, source, target FROM agent_logs ORDER BY id`,
      )
      .all() as Array<{
      category: string;
      message: string;
      source: string | null;
      target: string | null;
    }>;

    // http → browser/daemon（无论开始还是结束，旧数据只有一条记录，安全地当作请求方向）
    expect(rows[0]).toMatchObject({
      category: 'http',
      source: 'browser',
      target: 'daemon',
    });
    expect(rows[1]).toMatchObject({
      category: 'http',
      source: 'browser',
      target: 'daemon',
    });
    // sse → daemon/browser
    expect(rows[2]).toMatchObject({
      category: 'sse',
      source: 'daemon',
      target: 'browser',
    });
    // 其余分类一律保持 NULL：codex-runtime 请求/响应同分类，猜错比不猜更坏
    expect(rows[3]).toMatchObject({
      category: 'codex-runtime',
      source: null,
      target: null,
    });
    expect(rows[4]).toMatchObject({
      category: 'canvas-action',
      source: null,
      target: null,
    });
    expect(rows[5]).toMatchObject({
      category: 'system',
      source: null,
      target: null,
    });

    db.close();
  });

  it('source/target 列可空，内部新记录落库后方向为 NULL', () => {
    const db = openDatabase(createOldSchemaDb());

    const columns = db
      .prepare('PRAGMA table_info(agent_logs)')
      .all() as Array<{ name: string; notnull: number }>;
    const sourceColumn = columns.find((column) => column.name === 'source');
    const targetColumn = columns.find((column) => column.name === 'target');

    expect(sourceColumn?.notnull).toBe(0);
    expect(targetColumn?.notnull).toBe(0);

    // 不带方向的内部记录必须能正常插入，且读出 NULL。
    db.prepare(
      `INSERT INTO agent_logs (timestamp, category, message) VALUES (?, ?, ?)`,
    ).run(7, 'system', 'db_migrated');
    const last = db
      .prepare(`SELECT source, target FROM agent_logs ORDER BY id DESC LIMIT 1`)
      .get() as { source: string | null; target: string | null };

    expect(last.source).toBeNull();
    expect(last.target).toBeNull();

    db.close();
  });

  it('重复打开数据库不会重复回填（幂等）', () => {
    const path = createOldSchemaDb();
    const first = openDatabase(path);
    first.close();

    const second = openDatabase(path);
    const httpRows = second
      .prepare(`SELECT source, target FROM agent_logs WHERE category = 'http'`)
      .all() as Array<{ source: string; target: string }>;

    for (const row of httpRows) {
      expect(row).toEqual({ source: 'browser', target: 'daemon' });
    }
    second.close();
  });
});

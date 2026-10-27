import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CanvasRepository } from '../src/paint/repository.js';
import { openDatabase } from '../src/storage/database.js';

function canvasRecord(id: string) {
  return {
    id,
    name: '测试画布',
    width: 800,
    height: 600,
    backgroundColor: '#ffffff',
    revision: 0,
    undoCursorRevision: 0,
    codexThreadId: null,
    createdAt: 0,
    updatedAt: 0,
  };
}

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('canvases.codexThreadId', () => {
  it('stores, reads back and clears the thread of a canvas', () => {
    const db = openDatabase(':memory:');

    try {
      const canvases = new CanvasRepository(db);
      canvases.create(canvasRecord('canvas-1'));

      expect(canvases.findById('canvas-1')?.codexThreadId).toBeNull();

      canvases.setCodexThreadId('canvas-1', 'thread-1');
      expect(canvases.findById('canvas-1')?.codexThreadId).toBe('thread-1');

      canvases.setCodexThreadId('canvas-1', null);
      expect(canvases.findById('canvas-1')?.codexThreadId).toBeNull();
    } finally {
      db.close();
    }
  });

  it('adds the column to a database created before this slice', () => {
    const directory = mkdtempSync(join(tmpdir(), 'paintcodex-thread-'));
    const dbPath = join(directory, 'canvas.db');
    directories.push(directory);

    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE canvases (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        backgroundColor TEXT NOT NULL,
        revision INTEGER NOT NULL,
        undoCursorRevision INTEGER,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      );
    `);
    legacy.close();

    const db = openDatabase(dbPath);
    try {
      const columns = db
        .prepare<[], { name: string }>('PRAGMA table_info(canvases)')
        .all();

      expect(columns.map((column) => column.name)).toContain('codexThreadId');
    } finally {
      db.close();
    }
  });

  it('applies the migration twice without failing', () => {
    const directory = mkdtempSync(join(tmpdir(), 'paintcodex-thread-'));
    const dbPath = join(directory, 'canvas.db');
    directories.push(directory);

    const first = openDatabase(dbPath);
    first.close();

    const second = openDatabase(dbPath);
    try {
      const columns = second
        .prepare<[], { name: string }>('PRAGMA table_info(canvases)')
        .all();

      expect(
        columns.filter((column) => column.name === 'codexThreadId'),
      ).toHaveLength(1);
    } finally {
      second.close();
    }
  });
});

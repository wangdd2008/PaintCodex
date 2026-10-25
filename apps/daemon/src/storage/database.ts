import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type DatabaseConnection = InstanceType<typeof Database>;

export function openDatabase(dbPath: string): DatabaseConnection {
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);

  return db;
}

function migrate(db: DatabaseConnection): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS canvases (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      backgroundColor TEXT NOT NULL,
      revision INTEGER NOT NULL,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS layers (
      id TEXT PRIMARY KEY,
      canvasId TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('raster', 'vector', 'ai-generated')),
      zIndex INTEGER NOT NULL,
      visible INTEGER NOT NULL DEFAULT 1,
      opacity REAL NOT NULL DEFAULT 1.0,
      content TEXT NOT NULL,
      metadata TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      FOREIGN KEY (canvasId) REFERENCES canvases(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS layers_canvas_zindex ON layers(canvasId, zIndex);
  `);
}

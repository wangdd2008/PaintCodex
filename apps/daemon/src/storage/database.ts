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
      undoCursorRevision INTEGER,
      codexThreadId TEXT,
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

    CREATE TABLE IF NOT EXISTS snapshots (
      id TEXT PRIMARY KEY,
      canvasId TEXT NOT NULL,
      revision INTEGER NOT NULL,
      state TEXT NOT NULL,
      actor TEXT NOT NULL CHECK(actor IN ('user', 'agent')),
      action TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      FOREIGN KEY (canvasId) REFERENCES canvases(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS snapshots_canvas_revision ON snapshots(canvasId, revision);

    CREATE TABLE IF NOT EXISTS agent_logs (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      trace_id      TEXT,
      span_id       TEXT,
      parent_id     TEXT,
      timestamp     INTEGER NOT NULL,
      level         TEXT CHECK(level IN ('debug','info','warn','error')),
      category      TEXT NOT NULL,
      message       TEXT NOT NULL,
      payload       TEXT,
      duration_ms   INTEGER,
      error         TEXT,
      canvas_id     TEXT,
      revision      INTEGER,
      actor         TEXT,
      source        TEXT,
      target        TEXT
    );

    CREATE INDEX IF NOT EXISTS agent_logs_timestamp ON agent_logs(timestamp DESC);
    CREATE INDEX IF NOT EXISTS agent_logs_trace ON agent_logs(trace_id, timestamp);
    CREATE INDEX IF NOT EXISTS agent_logs_category_timestamp
      ON agent_logs(category, timestamp DESC);
  `);

  const canvasColumns = db
    .prepare<[], { name: string }>('PRAGMA table_info(canvases)')
    .all();

  if (!canvasColumns.some((column) => column.name === 'undoCursorRevision')) {
    db.exec('ALTER TABLE canvases ADD COLUMN undoCursorRevision INTEGER');
  }

  if (!canvasColumns.some((column) => column.name === 'codexThreadId')) {
    db.exec('ALTER TABLE canvases ADD COLUMN codexThreadId TEXT');
  }

  // 日志方向（monitor-readability ③01）：新增两个可空列。旧库没有这两列时
  // 补上，再只回填能安全推导方向的两类历史记录。其余保持 NULL——
  // `codex-runtime` 里请求与响应同分类，单凭 category 推方向会猜错，
  // 而错误的箭头比没有箭头更坏。
  const logColumns = db
    .prepare<[], { name: string }>('PRAGMA table_info(agent_logs)')
    .all();

  if (!logColumns.some((column) => column.name === 'source')) {
    db.exec('ALTER TABLE agent_logs ADD COLUMN source TEXT');
  }

  if (!logColumns.some((column) => column.name === 'target')) {
    db.exec('ALTER TABLE agent_logs ADD COLUMN target TEXT');
  }

  db.exec(`
    UPDATE agent_logs SET source = 'browser', target = 'daemon'
      WHERE category = 'http' AND source IS NULL;
    UPDATE agent_logs SET source = 'daemon', target = 'browser'
      WHERE category = 'sse' AND source IS NULL;
  `);
}

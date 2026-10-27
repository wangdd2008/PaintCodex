import type {
  Actor,
  Canvas,
  Layer,
  LayerContent,
  LayerMetadata,
  LayerType,
  UpdateLayerPatch,
} from '@paintcodex/protocol';
import type { DatabaseConnection } from '../storage/database.js';

export interface NewCanvasRecord {
  id: string;
  name: string;
  width: number;
  height: number;
  backgroundColor: string;
  revision: number;
  undoCursorRevision: number | null;
  /** Codex app-server thread that remembers this canvas' conversation. */
  codexThreadId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CanvasRecord extends Canvas {
  undoCursorRevision: number | null;
  codexThreadId: string | null;
}

export interface NewLayerRecord {
  id: string;
  canvasId: string;
  name: string;
  type: LayerType;
  zIndex: number;
  visible: boolean;
  opacity: number;
  content: LayerContent;
  metadata: LayerMetadata;
  createdAt: number;
}

export interface NewSnapshotRecord {
  id: string;
  canvasId: string;
  revision: number;
  state: string;
  actor: Actor;
  action: string;
  timestamp: number;
}

export type SnapshotRecord = NewSnapshotRecord;

interface LayerRow {
  id: string;
  canvasId: string;
  name: string;
  type: LayerType;
  zIndex: number;
  visible: number;
  opacity: number;
  content: string;
  metadata: string;
  createdAt: number;
}

const CANVAS_COLUMNS =
  'id, name, width, height, backgroundColor, revision, undoCursorRevision, codexThreadId, createdAt, updatedAt';

const SNAPSHOT_COLUMNS =
  'id, canvasId, revision, state, actor, action, timestamp';

export class CanvasRepository {
  constructor(private readonly db: DatabaseConnection) {}

  create(record: NewCanvasRecord): CanvasRecord {
    this.db
      .prepare(
        `INSERT INTO canvases (id, name, width, height, backgroundColor, revision, undoCursorRevision, codexThreadId, createdAt, updatedAt)
         VALUES (@id, @name, @width, @height, @backgroundColor, @revision, @undoCursorRevision, @codexThreadId, @createdAt, @updatedAt)`,
      )
      .run(record);

    return record;
  }

  findById(id: string): CanvasRecord | null {
    const row = this.db
      .prepare<[string], CanvasRecord>(
        `SELECT ${CANVAS_COLUMNS} FROM canvases WHERE id = ?`,
      )
      .get(id);

    return row ?? null;
  }

  /**
   * Renames a canvas without touching `revision`: identity is not content, so a
   * rename must not create an undo step or invalidate an in-flight save.
   */
  rename(id: string, name: string): CanvasRecord | null {
    this.db
      .prepare(`UPDATE canvases SET name = ?, updatedAt = ? WHERE id = ?`)
      .run(name, Date.now(), id);

    return this.findById(id);
  }

  bumpRevision(id: string): CanvasRecord | null {
    this.db
      .prepare(`UPDATE canvases SET revision = revision + 1, updatedAt = ? WHERE id = ?`)
      .run(Date.now(), id);

    return this.findById(id);
  }

  setUndoCursor(id: string, revision: number | null): void {
    this.db
      .prepare(`UPDATE canvases SET undoCursorRevision = ? WHERE id = ?`)
      .run(revision, id);
  }

  /**
   * Remembers (or forgets, with `null`) the Codex thread of a canvas. Thread
   * identity is not document content: like a rename, it must not bump the
   * revision or disturb an in-flight save.
   */
  setCodexThreadId(id: string, threadId: string | null): void {
    this.db
      .prepare(`UPDATE canvases SET codexThreadId = ? WHERE id = ?`)
      .run(threadId, id);
  }
}

export class LayerRepository {
  constructor(private readonly db: DatabaseConnection) {}

  insert(record: NewLayerRecord): Layer {
    this.db
      .prepare(
        `INSERT INTO layers (id, canvasId, name, type, zIndex, visible, opacity, content, metadata, createdAt)
         VALUES (@id, @canvasId, @name, @type, @zIndex, @visible, @opacity, @content, @metadata, @createdAt)`,
      )
      .run({
        ...record,
        visible: record.visible ? 1 : 0,
        content: JSON.stringify(record.content),
        metadata: JSON.stringify(record.metadata),
      });

    return record;
  }

  find(canvasId: string, layerId: string): Layer | null {
    const row = this.db
      .prepare<[string, string], LayerRow>(
        `SELECT id, canvasId, name, type, zIndex, visible, opacity, content, metadata, createdAt
         FROM layers
         WHERE canvasId = ? AND id = ?`,
      )
      .get(canvasId, layerId);

    return row ? toLayer(row) : null;
  }

  listByCanvas(canvasId: string): Layer[] {
    const rows = this.db
      .prepare<[string], LayerRow>(
        `SELECT id, canvasId, name, type, zIndex, visible, opacity, content, metadata, createdAt
         FROM layers
         WHERE canvasId = ?
         ORDER BY zIndex ASC, createdAt ASC`,
      )
      .all(canvasId);

    return rows.map(toLayer);
  }

  update(canvasId: string, layerId: string, patch: UpdateLayerPatch): Layer | null {
    const existing = this.find(canvasId, layerId);

    if (!existing) {
      return null;
    }

    const next = {
      name: patch.name ?? existing.name,
      visible: patch.visible ?? existing.visible,
      opacity: patch.opacity ?? existing.opacity,
      content: patch.content ?? existing.content,
    };

    this.db
      .prepare(
        `UPDATE layers
         SET name = @name, visible = @visible, opacity = @opacity, content = @content
         WHERE canvasId = @canvasId AND id = @id`,
      )
      .run({
        ...next,
        content: JSON.stringify(next.content),
        visible: next.visible ? 1 : 0,
        canvasId,
        id: layerId,
      });

    return { ...existing, ...next };
  }

  delete(canvasId: string, layerId: string): boolean {
    const info = this.db
      .prepare(`DELETE FROM layers WHERE canvasId = ? AND id = ?`)
      .run(canvasId, layerId);

    return info.changes > 0;
  }

  nextZIndex(canvasId: string): number {
    const row = this.db
      .prepare<[string], { maxZIndex: number | null }>(
        `SELECT MAX(zIndex) AS maxZIndex FROM layers WHERE canvasId = ?`,
      )
      .get(canvasId);

    return (row?.maxZIndex ?? -1) + 1;
  }

  replaceAll(canvasId: string, layers: Layer[]): void {
    const replace = this.db.transaction((id: string, entries: Layer[]) => {
      this.db.prepare(`DELETE FROM layers WHERE canvasId = ?`).run(id);

      for (const layer of entries) {
        this.insert({
          id: layer.id,
          canvasId: id,
          name: layer.name,
          type: layer.type,
          zIndex: layer.zIndex,
          visible: layer.visible,
          opacity: layer.opacity,
          content: layer.content,
          metadata: layer.metadata,
          createdAt: layer.createdAt,
        });
      }
    });

    replace(canvasId, layers);
  }
}

export class SnapshotRepository {
  constructor(private readonly db: DatabaseConnection) {}

  insert(record: NewSnapshotRecord): void {
    this.db
      .prepare(
        `INSERT INTO snapshots (id, canvasId, revision, state, actor, action, timestamp)
         VALUES (@id, @canvasId, @revision, @state, @actor, @action, @timestamp)`,
      )
      .run(record);
  }

  latest(canvasId: string): SnapshotRecord | null {
    const row = this.db
      .prepare<[string], SnapshotRecord>(
        `SELECT ${SNAPSHOT_COLUMNS}
         FROM snapshots
         WHERE canvasId = ?
         ORDER BY revision DESC
         LIMIT 1`,
      )
      .get(canvasId);

    return row ?? null;
  }

  /** The snapshot recorded exactly at `revision` (the undo cursor points at one). */
  at(canvasId: string, revision: number): SnapshotRecord | null {
    const row = this.db
      .prepare<[string, number], SnapshotRecord>(
        `SELECT ${SNAPSHOT_COLUMNS}
         FROM snapshots
         WHERE canvasId = ? AND revision = ?
         LIMIT 1`,
      )
      .get(canvasId, revision);

    return row ?? null;
  }

  before(canvasId: string, revision: number): SnapshotRecord | null {
    const row = this.db
      .prepare<[string, number], SnapshotRecord>(
        `SELECT ${SNAPSHOT_COLUMNS}
         FROM snapshots
         WHERE canvasId = ? AND revision < ?
         ORDER BY revision DESC
         LIMIT 1`,
      )
      .get(canvasId, revision);

    return row ?? null;
  }

  after(canvasId: string, revision: number): SnapshotRecord | null {
    const row = this.db
      .prepare<[string, number], SnapshotRecord>(
        `SELECT ${SNAPSHOT_COLUMNS}
         FROM snapshots
         WHERE canvasId = ? AND revision > ?
         ORDER BY revision ASC
         LIMIT 1`,
      )
      .get(canvasId, revision);

    return row ?? null;
  }

  truncateAfter(canvasId: string, revision: number): void {
    this.db
      .prepare(`DELETE FROM snapshots WHERE canvasId = ? AND revision > ?`)
      .run(canvasId, revision);
  }

  trim(canvasId: string, keep: number): void {
    const revisions = this.db
      .prepare<[string, number], { revision: number }>(
        `SELECT revision
         FROM snapshots
         WHERE canvasId = ?
         ORDER BY revision DESC
         LIMIT ?`,
      )
      .all(canvasId, keep);

    const oldest = revisions[revisions.length - 1]?.revision;

    if (oldest !== undefined) {
      this.db
        .prepare(`DELETE FROM snapshots WHERE canvasId = ? AND revision < ?`)
        .run(canvasId, oldest);
    }
  }
}

function toLayer(row: LayerRow): Layer {
  return {
    ...row,
    visible: row.visible === 1,
    content: JSON.parse(row.content) as LayerContent,
    metadata: JSON.parse(row.metadata) as LayerMetadata,
  };
}

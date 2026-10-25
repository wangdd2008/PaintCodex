import type {
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
  createdAt: number;
  updatedAt: number;
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

export class CanvasRepository {
  constructor(private readonly db: DatabaseConnection) {}

  create(record: NewCanvasRecord): Canvas {
    this.db
      .prepare(
        `INSERT INTO canvases (id, name, width, height, backgroundColor, revision, createdAt, updatedAt)
         VALUES (@id, @name, @width, @height, @backgroundColor, @revision, @createdAt, @updatedAt)`,
      )
      .run(record);

    return record;
  }

  findById(id: string): Canvas | null {
    const row = this.db
      .prepare<[string], Canvas>(
        `SELECT id, name, width, height, backgroundColor, revision, createdAt, updatedAt
         FROM canvases
         WHERE id = ?`,
      )
      .get(id);

    return row ?? null;
  }

  bumpRevision(id: string): Canvas | null {
    this.db
      .prepare(`UPDATE canvases SET revision = revision + 1, updatedAt = ? WHERE id = ?`)
      .run(Date.now(), id);

    return this.findById(id);
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
      zIndex: patch.zIndex ?? existing.zIndex,
    };

    this.db
      .prepare(
        `UPDATE layers
         SET name = @name, visible = @visible, opacity = @opacity, zIndex = @zIndex
         WHERE canvasId = @canvasId AND id = @id`,
      )
      .run({
        ...next,
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
}

function toLayer(row: LayerRow): Layer {
  return {
    ...row,
    visible: row.visible === 1,
    content: JSON.parse(row.content) as LayerContent,
    metadata: JSON.parse(row.metadata) as LayerMetadata,
  };
}

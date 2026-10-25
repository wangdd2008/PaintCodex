import type { Canvas } from '@paintcodex/protocol';
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
}

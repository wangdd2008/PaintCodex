import { randomUUID } from 'node:crypto';
import type {
  Actor,
  ApplyActionRequest,
  Canvas,
  CanvasDocument,
  CanvasState,
  CreateCanvasRequest,
} from '@paintcodex/protocol';
import {
  CanvasNotFoundError,
  LayerNotFoundError,
  NothingToRedoError,
  NothingToUndoError,
  RevisionConflictError,
} from './errors.js';
import type { ObservabilityLogger } from '../observability/logger.js';
import type { PaintEvents } from './events.js';
import {
  CanvasRepository,
  LayerRepository,
  SnapshotRepository,
  type CanvasRecord,
  type SnapshotRecord,
} from './repository.js';

export const DEFAULT_CANVAS_WIDTH = 1920;
export const DEFAULT_CANVAS_HEIGHT = 1080;
export const MAX_CANVAS_DIMENSION = 8192;
export const SNAPSHOT_LIMIT = 20;

/**
 * A canvas without a name is still a document the user must be able to tell
 * apart from the next one, so the default carries the local wall-clock time
 * the daemon created it at (`未命名 2026-10-26 14:32`).
 */
export function defaultCanvasName(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');

  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

  return `未命名 ${date} ${time}`;
}

const ACTION_LOG_MESSAGES = {
  canvas_create_layer: 'layer_create',
  canvas_update_layer: 'layer_update',
  canvas_delete_layer: 'layer_delete',
} as const;

export class PaintService {
  constructor(
    private readonly canvases: CanvasRepository,
    private readonly layers: LayerRepository,
    private readonly snapshots: SnapshotRepository,
    private readonly events: PaintEvents,
    private readonly observability?: ObservabilityLogger,
  ) {}

  createCanvas(input: CreateCanvasRequest = {}): CanvasDocument {
    const now = Date.now();
    const canvas = this.canvases.create({
      id: randomUUID(),
      name: input.name !== undefined ? input.name.trim() : defaultCanvasName(),
      width: input.width ?? DEFAULT_CANVAS_WIDTH,
      height: input.height ?? DEFAULT_CANVAS_HEIGHT,
      backgroundColor: input.backgroundColor ?? '#ffffff',
      revision: 0,
      undoCursorRevision: 0,
      createdAt: now,
      updatedAt: now,
    });

    const document: CanvasDocument = {
      ...toCanvas(canvas),
      layers: [],
      history: { canUndo: false, canRedo: false },
    };
    this.recordSnapshot(canvas.id, canvas.revision, 'user', 'canvas_create', document);
    this.logCanvasAction({
      message: 'canvas_create',
      canvasId: canvas.id,
      revision: 0,
      actor: 'user',
      payload: { name: canvas.name, width: canvas.width, height: canvas.height },
    });

    return document;
  }

  getCanvas(id: string): CanvasDocument | null {
    const canvas = this.canvases.findById(id);

    return canvas ? this.toDocument(canvas) : null;
  }

  /**
   * Renaming is an identity change, not a document mutation: it keeps the
   * revision, the undo stack, and any in-flight stroke's `expectedRevision`
   * untouched, and returns the same shape `GET /paint/canvas/:id` returns.
   */
  renameCanvas(canvasId: string, name: string): CanvasDocument {
    const renamed = this.canvases.rename(canvasId, name.trim());

    if (!renamed) {
      throw new CanvasNotFoundError();
    }

    this.logCanvasAction({
      message: 'canvas_rename',
      canvasId,
      revision: renamed.revision,
      actor: 'user',
      payload: { name: renamed.name },
    });

    return this.toDocument(renamed);
  }

  applyAction(canvasId: string, request: ApplyActionRequest): CanvasDocument {
    const canvas = this.canvases.findById(canvasId);

    if (!canvas) {
      throw new CanvasNotFoundError();
    }

    this.assertRevision(canvas, request.expectedRevision);
    this.prepareHistory(canvas);

    let createdLayerId: string | null = null;

    switch (request.action.type) {
      case 'canvas_create_layer': {
        const input = request.action.layer;
        const now = Date.now();
        const layerId = randomUUID();

        createdLayerId = layerId;
        this.layers.insert({
          id: layerId,
          canvasId,
          name: input.name,
          type: input.type,
          zIndex: this.layers.nextZIndex(canvasId),
          visible: input.visible ?? true,
          opacity: input.opacity ?? 1,
          content: input.content,
          metadata: {
            createdAt: now,
            ...input.metadata,
            createdBy: request.actor,
          },
          createdAt: now,
        });
        break;
      }

      case 'canvas_update_layer': {
        const updated = this.layers.update(
          canvasId,
          request.action.layerId,
          request.action.patch,
        );

        if (!updated) {
          throw new LayerNotFoundError();
        }
        break;
      }

      case 'canvas_delete_layer': {
        const deleted = this.layers.delete(canvasId, request.action.layerId);

        if (!deleted) {
          throw new LayerNotFoundError();
        }
        break;
      }
    }

    const bumped = this.canvases.bumpRevision(canvasId);

    if (!bumped) {
      throw new CanvasNotFoundError();
    }

    this.canvases.setUndoCursor(canvasId, bumped.revision);

    const updated = this.getCanvas(canvasId)!;
    this.recordSnapshot(
      canvasId,
      bumped.revision,
      request.actor,
      request.action.type,
      updated,
    );
    this.events.publishSnapshot(canvasId, bumped.revision);
    this.logCanvasAction({
      message: ACTION_LOG_MESSAGES[request.action.type],
      canvasId,
      revision: bumped.revision,
      actor: request.actor,
      payload:
        request.action.type === 'canvas_create_layer'
          ? { layerId: createdLayerId, layerType: request.action.layer.type }
          : { layerId: request.action.layerId },
    });

    return updated;
  }

  undo(canvasId: string, expectedRevision?: number): CanvasDocument {
    const canvas = this.canvases.findById(canvasId);

    if (!canvas) {
      throw new CanvasNotFoundError();
    }

    this.assertRevision(canvas, expectedRevision);

    const cursor = this.cursor(canvas);
    const target = cursor === null ? null : this.snapshots.before(canvasId, cursor);

    if (!target) {
      throw new NothingToUndoError();
    }

    this.restore(canvasId, target);
    this.canvases.setUndoCursor(canvasId, target.revision);

    const bumped = this.canvases.bumpRevision(canvasId);

    if (!bumped) {
      throw new CanvasNotFoundError();
    }

    const updated = this.getCanvas(canvasId)!;
    this.events.publishSnapshot(canvasId, bumped.revision);
    this.logCanvasAction({
      message: 'undo',
      canvasId,
      revision: bumped.revision,
      actor: 'user',
      payload: { restoredRevision: target.revision },
    });

    return updated;
  }

  redo(canvasId: string, expectedRevision?: number): CanvasDocument {
    const canvas = this.canvases.findById(canvasId);

    if (!canvas) {
      throw new CanvasNotFoundError();
    }

    this.assertRevision(canvas, expectedRevision);

    const cursor = this.cursor(canvas);
    const target = cursor === null ? null : this.snapshots.after(canvasId, cursor);

    if (!target) {
      throw new NothingToRedoError();
    }

    this.restore(canvasId, target);
    this.canvases.setUndoCursor(canvasId, target.revision);

    const bumped = this.canvases.bumpRevision(canvasId);

    if (!bumped) {
      throw new CanvasNotFoundError();
    }

    const updated = this.getCanvas(canvasId)!;
    this.events.publishSnapshot(canvasId, bumped.revision);
    this.logCanvasAction({
      message: 'redo',
      canvasId,
      revision: bumped.revision,
      actor: 'user',
      payload: { restoredRevision: target.revision },
    });

    return updated;
  }

  private logCanvasAction(input: {
    message: string;
    canvasId: string;
    revision: number;
    actor: Actor;
    payload: unknown;
  }): void {
    this.observability?.log({
      category: 'canvas-action',
      level: 'info',
      ...input,
    });
  }

  private prepareHistory(canvas: CanvasRecord): void {
    const latest = this.snapshots.latest(canvas.id);

    if (!latest) {
      this.recordSnapshot(
        canvas.id,
        canvas.revision,
        'user',
        'canvas_snapshot',
        this.toDocument(canvas),
      );
      this.canvases.setUndoCursor(canvas.id, canvas.revision);
      return;
    }

    const cursor = canvas.undoCursorRevision ?? latest.revision;

    if (canvas.undoCursorRevision === null) {
      this.canvases.setUndoCursor(canvas.id, cursor);
    }

    this.snapshots.truncateAfter(canvas.id, cursor);
  }

  private restore(canvasId: string, snapshot: SnapshotRecord): void {
    const state = JSON.parse(snapshot.state) as CanvasState;
    this.layers.replaceAll(canvasId, state.layers);
  }

  private recordSnapshot(
    canvasId: string,
    revision: number,
    actor: Actor,
    action: string,
    document: CanvasDocument,
  ): void {
    this.snapshots.insert({
      id: randomUUID(),
      canvasId,
      revision,
      state: JSON.stringify(toCanvasState(document)),
      actor,
      action,
      timestamp: Date.now(),
    });
    this.snapshots.trim(canvasId, SNAPSHOT_LIMIT);
  }

  private cursor(canvas: CanvasRecord): number | null {
    if (canvas.undoCursorRevision !== null) {
      return canvas.undoCursorRevision;
    }

    return this.snapshots.latest(canvas.id)?.revision ?? null;
  }

  private toDocument(canvas: CanvasRecord): CanvasDocument {
    return {
      ...toCanvas(canvas),
      layers: this.layers.listByCanvas(canvas.id),
      history: this.historyState(canvas),
    };
  }

  private historyState(canvas: CanvasRecord) {
    const cursor = this.cursor(canvas);

    return {
      canUndo: cursor !== null && this.snapshots.before(canvas.id, cursor) !== null,
      canRedo: cursor !== null && this.snapshots.after(canvas.id, cursor) !== null,
    };
  }

  private assertRevision(canvas: CanvasRecord, expectedRevision?: number): void {
    if (expectedRevision !== undefined && expectedRevision !== canvas.revision) {
      throw new RevisionConflictError(expectedRevision, canvas.revision);
    }
  }
}

function toCanvas(record: CanvasRecord): Canvas {
  return {
    id: record.id,
    name: record.name,
    width: record.width,
    height: record.height,
    backgroundColor: record.backgroundColor,
    revision: record.revision,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function toCanvasState(document: CanvasDocument): CanvasState {
  return {
    id: document.id,
    name: document.name,
    width: document.width,
    height: document.height,
    backgroundColor: document.backgroundColor,
    revision: document.revision,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    layers: document.layers,
  };
}

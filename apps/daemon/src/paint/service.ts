import { randomUUID } from 'node:crypto';
import type {
  ApplyActionRequest,
  CanvasDocument,
  CreateCanvasRequest,
} from '@paintcodex/protocol';
import { CanvasNotFoundError, LayerNotFoundError, RevisionConflictError } from './errors.js';
import { CanvasRepository, LayerRepository } from './repository.js';

export const DEFAULT_CANVAS_WIDTH = 1920;
export const DEFAULT_CANVAS_HEIGHT = 1080;
export const MAX_CANVAS_DIMENSION = 8192;

export class PaintService {
  constructor(
    private readonly canvases: CanvasRepository,
    private readonly layers: LayerRepository,
  ) {}

  createCanvas(input: CreateCanvasRequest = {}): CanvasDocument {
    const now = Date.now();
    const canvas = this.canvases.create({
      id: randomUUID(),
      name: input.name?.trim() || 'Untitled',
      width: input.width ?? DEFAULT_CANVAS_WIDTH,
      height: input.height ?? DEFAULT_CANVAS_HEIGHT,
      backgroundColor: input.backgroundColor ?? '#ffffff',
      revision: 0,
      createdAt: now,
      updatedAt: now,
    });

    return { ...canvas, layers: [] };
  }

  getCanvas(id: string): CanvasDocument | null {
    const canvas = this.canvases.findById(id);

    if (!canvas) {
      return null;
    }

    return { ...canvas, layers: this.layers.listByCanvas(id) };
  }

  applyAction(canvasId: string, request: ApplyActionRequest): CanvasDocument {
    const canvas = this.canvases.findById(canvasId);

    if (!canvas) {
      throw new CanvasNotFoundError();
    }

    if (
      request.expectedRevision !== undefined &&
      request.expectedRevision !== canvas.revision
    ) {
      throw new RevisionConflictError(request.expectedRevision, canvas.revision);
    }

    switch (request.action.type) {
      case 'canvas_create_layer': {
        const input = request.action.layer;
        const now = Date.now();

        this.layers.insert({
          id: randomUUID(),
          canvasId,
          name: input.name,
          type: input.type,
          zIndex: input.zIndex ?? this.layers.nextZIndex(canvasId),
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

    this.canvases.bumpRevision(canvasId);

    return this.getCanvas(canvasId)!;
  }
}

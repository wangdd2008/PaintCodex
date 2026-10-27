import type {
  Actor,
  ApplyActionRequest,
  CanvasDocument,
  CreateCanvasRequest,
} from '@paintcodex/protocol';
import type { PaintService } from './service.js';

/**
 * The single mutation entry point for both human and agent actors.
 * `actor` rides on `ApplyActionRequest` for layer actions and is an explicit
 * argument for canvas-level operations, so the agent lane can pass `'agent'`.
 */
export class CommandDispatcher {
  constructor(private readonly service: PaintService) {}

  createCanvas(
    input: CreateCanvasRequest = {},
    actor: Actor = 'user',
  ): CanvasDocument {
    return this.service.createCanvas(input, actor);
  }

  renameCanvas(
    canvasId: string,
    name: string,
    actor: Actor = 'user',
  ): CanvasDocument {
    return this.service.renameCanvas(canvasId, name, actor);
  }

  dispatch(canvasId: string, request: ApplyActionRequest): CanvasDocument {
    return this.service.applyAction(canvasId, request);
  }

  undo(
    canvasId: string,
    expectedRevision?: number,
    actor: Actor = 'user',
  ): CanvasDocument {
    return this.service.undo(canvasId, expectedRevision, actor);
  }

  redo(
    canvasId: string,
    expectedRevision?: number,
    actor: Actor = 'user',
  ): CanvasDocument {
    return this.service.redo(canvasId, expectedRevision, actor);
  }
}

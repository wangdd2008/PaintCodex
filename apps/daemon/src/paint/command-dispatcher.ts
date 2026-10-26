import type {
  ApplyActionRequest,
  CanvasDocument,
  CreateCanvasRequest,
} from '@paintcodex/protocol';
import type { PaintService } from './service.js';

/**
 * The single mutation entry point for both human and agent actors.
 */
export class CommandDispatcher {
  constructor(private readonly service: PaintService) {}

  createCanvas(input: CreateCanvasRequest = {}): CanvasDocument {
    return this.service.createCanvas(input);
  }

  renameCanvas(canvasId: string, name: string): CanvasDocument {
    return this.service.renameCanvas(canvasId, name);
  }

  dispatch(canvasId: string, request: ApplyActionRequest): CanvasDocument {
    return this.service.applyAction(canvasId, request);
  }

  undo(canvasId: string, expectedRevision?: number): CanvasDocument {
    return this.service.undo(canvasId, expectedRevision);
  }

  redo(canvasId: string, expectedRevision?: number): CanvasDocument {
    return this.service.redo(canvasId, expectedRevision);
  }
}

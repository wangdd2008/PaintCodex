import type { ApplyActionRequest, CanvasDocument } from '@paintcodex/protocol';
import type { PaintService } from './service.js';

/**
 * The single mutation entry point for both human and agent actors.
 */
export class CommandDispatcher {
  constructor(private readonly service: PaintService) {}

  dispatch(canvasId: string, request: ApplyActionRequest): CanvasDocument {
    return this.service.applyAction(canvasId, request);
  }
}

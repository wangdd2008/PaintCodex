import type {
  Actor,
  ApplyActionRequest,
  CanvasDocument,
  CreateCanvasRequest,
} from '@paintcodex/protocol';
import type { TraceContext } from '../observability/logger.js';
import type { PaintService } from './service.js';

/**
 * The single mutation entry point for both human and agent actors.
 * `actor` rides on `ApplyActionRequest` for layer actions and is an explicit
 * argument for canvas-level operations, so the agent lane can pass `'agent'`.
 *
 * 可选的 `trace` 把一次写入归属到发起它的追踪：AI 工具传 turn span，REST 传
 * HTTP span；不传的后台任务/测试仍记录 NULL trace。
 */
export class CommandDispatcher {
  constructor(private readonly service: PaintService) {}

  createCanvas(
    input: CreateCanvasRequest = {},
    actor: Actor = 'user',
    trace?: TraceContext,
  ): CanvasDocument {
    return this.service.createCanvas(input, actor, trace);
  }

  renameCanvas(
    canvasId: string,
    name: string,
    actor: Actor = 'user',
    trace?: TraceContext,
  ): CanvasDocument {
    return this.service.renameCanvas(canvasId, name, actor, trace);
  }

  dispatch(
    canvasId: string,
    request: ApplyActionRequest,
    trace?: TraceContext,
  ): CanvasDocument {
    return this.service.applyAction(canvasId, request, trace);
  }

  undo(
    canvasId: string,
    expectedRevision?: number,
    actor: Actor = 'user',
    trace?: TraceContext,
  ): CanvasDocument {
    return this.service.undo(canvasId, expectedRevision, actor, trace);
  }

  redo(
    canvasId: string,
    expectedRevision?: number,
    actor: Actor = 'user',
    trace?: TraceContext,
  ): CanvasDocument {
    return this.service.redo(canvasId, expectedRevision, actor, trace);
  }
}

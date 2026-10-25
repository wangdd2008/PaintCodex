import type { FastifyInstance, FastifyReply } from 'fastify';
import type {
  Actor,
  ApplyActionRequest,
  CreateCanvasRequest,
  CreateLayerInput,
  HistoryRequest,
  LayerContent,
  LayerType,
  UpdateLayerPatch,
} from '@paintcodex/protocol';
import { CommandDispatcher } from '../paint/command-dispatcher.js';
import {
  CanvasNotFoundError,
  LayerNotFoundError,
  NothingToRedoError,
  NothingToUndoError,
  RevisionConflictError,
} from '../paint/errors.js';
import { MAX_CANVAS_DIMENSION, type PaintService } from '../paint/service.js';

type LayerCreateBody = CreateLayerInput & {
  expectedRevision?: number;
  actor?: Actor;
};

type LayerUpdateBody = UpdateLayerPatch & {
  expectedRevision?: number;
  actor?: Actor;
};

export function registerPaintRoutes(app: FastifyInstance, service: PaintService): void {
  const dispatcher = new CommandDispatcher(service);

  app.post<{ Body: CreateCanvasRequest }>('/paint/canvas', async (request, reply) => {
    const body = request.body ?? {};
    const validationError = validateCreateCanvas(body);

    if (validationError) {
      return reply.code(400).send({
        error: { code: 'invalid_canvas', message: validationError },
      });
    }

    return reply.code(201).send(service.createCanvas(body));
  });

  app.get<{ Params: { id: string } }>('/paint/canvas/:id', async (request, reply) => {
    const canvas = service.getCanvas(request.params.id);

    if (!canvas) {
      return reply.code(404).send({
        error: { code: 'canvas_not_found', message: 'Canvas not found' },
      });
    }

    return canvas;
  });

  app.post<{ Params: { id: string }; Body: LayerCreateBody }>(
    '/paint/canvas/:id/layers',
    async (request, reply) => {
      const body = request.body;
      const validationError = validateCreateLayer(body);

      if (validationError) {
        return reply.code(400).send({
          error: { code: 'invalid_layer', message: validationError },
        });
      }

      const { expectedRevision, actor, ...layer } = body;

      try {
        return reply.code(201).send(
          dispatcher.dispatch(request.params.id, {
            actor: actor ?? 'user',
            expectedRevision,
            action: { type: 'canvas_create_layer', layer },
          }),
        );
      } catch (error) {
        return sendPaintError(reply, error);
      }
    },
  );

  app.patch<{ Params: { id: string; layerId: string }; Body: LayerUpdateBody }>(
    '/paint/canvas/:id/layers/:layerId',
    async (request, reply) => {
      const body = request.body ?? {};
      const validationError = validateUpdateLayer(body);

      if (validationError) {
        return reply.code(400).send({
          error: { code: 'invalid_layer', message: validationError },
        });
      }

      const { expectedRevision, actor, ...patch } = body;

      try {
        return dispatcher.dispatch(request.params.id, {
          actor: actor ?? 'user',
          expectedRevision,
          action: {
            type: 'canvas_update_layer',
            layerId: request.params.layerId,
            patch,
          },
        });
      } catch (error) {
        return sendPaintError(reply, error);
      }
    },
  );

  app.delete<{
    Params: { id: string; layerId: string };
    Querystring: { expectedRevision?: string };
  }>('/paint/canvas/:id/layers/:layerId', async (request, reply) => {
    const expectedRevision = parseExpectedRevision(request.query.expectedRevision);

    if (expectedRevision === null) {
      return reply.code(400).send({
        error: {
          code: 'invalid_revision',
          message: 'expectedRevision must be an integer',
        },
      });
    }

    try {
      return dispatcher.dispatch(request.params.id, {
        actor: 'user',
        expectedRevision,
        action: {
          type: 'canvas_delete_layer',
          layerId: request.params.layerId,
        },
      });
    } catch (error) {
      return sendPaintError(reply, error);
    }
  });

  app.post<{ Params: { id: string }; Body: ApplyActionRequest }>(
    '/paint/canvas/:id/apply-action',
    async (request, reply) => {
      const body = request.body;
      const validationError = validateApplyAction(body);

      if (validationError) {
        return reply.code(400).send({
          error: { code: 'invalid_action', message: validationError },
        });
      }

      try {
        return dispatcher.dispatch(request.params.id, body);
      } catch (error) {
        return sendPaintError(reply, error);
      }
    },
  );

  app.post<{ Params: { id: string }; Body: HistoryRequest }>(
    '/paint/canvas/:id/undo',
    async (request, reply) => {
      const expectedRevision = parseBodyRevision(request.body?.expectedRevision);

      if (expectedRevision === null) {
        return invalidRevision(reply);
      }

      try {
        return service.undo(request.params.id, expectedRevision);
      } catch (error) {
        return sendPaintError(reply, error);
      }
    },
  );

  app.post<{ Params: { id: string }; Body: HistoryRequest }>(
    '/paint/canvas/:id/redo',
    async (request, reply) => {
      const expectedRevision = parseBodyRevision(request.body?.expectedRevision);

      if (expectedRevision === null) {
        return invalidRevision(reply);
      }

      try {
        return service.redo(request.params.id, expectedRevision);
      } catch (error) {
        return sendPaintError(reply, error);
      }
    },
  );
}

function sendPaintError(reply: FastifyReply, error: unknown) {
  if (error instanceof CanvasNotFoundError) {
    return reply
      .code(404)
      .send({ error: { code: 'canvas_not_found', message: 'Canvas not found' } });
  }

  if (error instanceof LayerNotFoundError) {
    return reply
      .code(404)
      .send({ error: { code: 'layer_not_found', message: 'Layer not found' } });
  }

  if (error instanceof RevisionConflictError) {
    return reply.code(409).send({
      error: { code: 'revision_conflict', message: error.message },
      currentRevision: error.currentRevision,
    });
  }

  if (error instanceof NothingToUndoError) {
    return reply
      .code(409)
      .send({ error: { code: 'nothing_to_undo', message: 'Nothing to undo' } });
  }

  if (error instanceof NothingToRedoError) {
    return reply
      .code(409)
      .send({ error: { code: 'nothing_to_redo', message: 'Nothing to redo' } });
  }

  throw error;
}

function invalidRevision(reply: FastifyReply) {
  return reply.code(400).send({
    error: {
      code: 'invalid_revision',
      message: 'expectedRevision must be an integer',
    },
  });
}

function validateCreateCanvas(input: CreateCanvasRequest): string | null {
  if (input.width !== undefined && !isValidDimension(input.width)) {
    return `width must be an integer between 1 and ${MAX_CANVAS_DIMENSION}`;
  }

  if (input.height !== undefined && !isValidDimension(input.height)) {
    return `height must be an integer between 1 and ${MAX_CANVAS_DIMENSION}`;
  }

  return null;
}

function validateCreateLayer(input: LayerCreateBody | undefined): string | null {
  if (!input) {
    return 'layer payload is required';
  }

  if (typeof input.name !== 'string' || input.name.trim() === '') {
    return 'name is required';
  }

  if (!isLayerType(input.type)) {
    return 'type must be raster, vector or ai-generated';
  }

  if (!isLayerContent(input.content)) {
    return 'content must be a fabric or svg payload';
  }

  return null;
}

function validateUpdateLayer(input: LayerUpdateBody): string | null {
  if (input.name !== undefined && typeof input.name !== 'string') {
    return 'name must be a string';
  }

  if (input.visible !== undefined && typeof input.visible !== 'boolean') {
    return 'visible must be a boolean';
  }

  if (
    input.opacity !== undefined &&
    (typeof input.opacity !== 'number' || input.opacity < 0 || input.opacity > 1)
  ) {
    return 'opacity must be a number between 0 and 1';
  }

  if (input.zIndex !== undefined && !Number.isInteger(input.zIndex)) {
    return 'zIndex must be an integer';
  }

  return null;
}

function validateApplyAction(input: ApplyActionRequest | undefined): string | null {
  if (!input) {
    return 'action payload is required';
  }

  if (input.actor !== 'user' && input.actor !== 'agent') {
    return 'actor must be user or agent';
  }

  if (!input.action || typeof input.action.type !== 'string') {
    return 'action.type is required';
  }

  return null;
}

function isLayerType(value: unknown): value is LayerType {
  return value === 'raster' || value === 'vector' || value === 'ai-generated';
}

function isLayerContent(value: unknown): value is LayerContent {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const content = value as { kind?: unknown; json?: unknown; svg?: unknown };

  if (content.kind === 'fabric') {
    return typeof content.json === 'string';
  }

  if (content.kind === 'svg') {
    return typeof content.svg === 'string';
  }

  return false;
}

function parseExpectedRevision(raw: string | undefined): number | undefined | null {
  if (raw === undefined) {
    return undefined;
  }

  const parsed = Number(raw);

  return Number.isInteger(parsed) ? parsed : null;
}

function parseBodyRevision(value: unknown): number | undefined | null {
  if (value === undefined) {
    return undefined;
  }

  return Number.isInteger(value) ? (value as number) : null;
}

function isValidDimension(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= MAX_CANVAS_DIMENSION
  );
}

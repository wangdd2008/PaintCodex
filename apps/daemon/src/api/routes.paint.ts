import type { FastifyInstance, FastifyReply } from 'fastify';
import { MAX_CANVAS_NAME_LENGTH } from '@paintcodex/protocol';
import type {
  Actor,
  ApplyActionRequest,
  CreateCanvasRequest,
  CreateLayerInput,
  HistoryRequest,
  LayerContent,
  LayerType,
  UpdateCanvasRequest,
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

    return reply.code(201).send(dispatcher.createCanvas(body));
  });

  app.get<{ Params: { id: string } }>('/paint/canvas/:id', async (request, reply) => {
    const canvas = service.getCanvas(request.params.id);

    if (!canvas) {
      return reply.code(404).send({
        error: { code: 'canvas_not_found', message: '画布不存在' },
      });
    }

    return canvas;
  });

  app.patch<{ Params: { id: string }; Body: UpdateCanvasRequest }>(
    '/paint/canvas/:id',
    async (request, reply) => {
      const validationError = validateUpdateCanvas(request.body);

      if (validationError) {
        return reply.code(400).send({
          error: { code: 'invalid_canvas', message: validationError },
        });
      }

      try {
        return dispatcher.renameCanvas(request.params.id, request.body.name.trim());
      } catch (error) {
        return sendPaintError(reply, error);
      }
    },
  );

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
          message: 'expectedRevision 必须是整数',
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
        return dispatcher.undo(request.params.id, expectedRevision);
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
        return dispatcher.redo(request.params.id, expectedRevision);
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
      .send({ error: { code: 'canvas_not_found', message: '画布不存在' } });
  }

  if (error instanceof LayerNotFoundError) {
    return reply
      .code(404)
      .send({ error: { code: 'layer_not_found', message: '图层不存在' } });
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
      .send({ error: { code: 'nothing_to_undo', message: '没有可撤销的操作' } });
  }

  if (error instanceof NothingToRedoError) {
    return reply
      .code(409)
      .send({ error: { code: 'nothing_to_redo', message: '没有可重做的操作' } });
  }

  throw error;
}

function invalidRevision(reply: FastifyReply) {
  return reply.code(400).send({
    error: {
      code: 'invalid_revision',
      message: 'expectedRevision 必须是整数',
    },
  });
}

function validateCreateCanvas(input: CreateCanvasRequest): string | null {
  if (input.name !== undefined) {
    const nameError = validateCanvasName(input.name);

    if (nameError) {
      return nameError;
    }
  }

  if (input.width !== undefined && !isValidDimension(input.width)) {
    return `宽度必须是 1 到 ${MAX_CANVAS_DIMENSION} 之间的整数`;
  }

  if (input.height !== undefined && !isValidDimension(input.height)) {
    return `高度必须是 1 到 ${MAX_CANVAS_DIMENSION} 之间的整数`;
  }

  return null;
}

/** `PATCH /paint/canvas/:id` accepts `name` and nothing else — no geometry. */
function validateUpdateCanvas(input: unknown): string | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return '请求体必须是包含 name 的对象';
  }

  const entries = Object.entries(input as Record<string, unknown>);
  const unknownField = entries.find(([key]) => key !== 'name');

  if (unknownField) {
    return `画布更新只接受 name，不接受字段 ${unknownField[0]}`;
  }

  if (entries.length === 0) {
    return '画布更新需要提供 name';
  }

  return validateCanvasName((input as { name?: unknown }).name);
}

function validateCanvasName(value: unknown): string | null {
  if (typeof value !== 'string') {
    return '画布名称必须是字符串';
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return '画布名称不能为空';
  }

  if (trimmed.length > MAX_CANVAS_NAME_LENGTH) {
    return `画布名称不能超过 ${MAX_CANVAS_NAME_LENGTH} 个字符`;
  }

  return null;
}

function validateCreateLayer(input: LayerCreateBody | undefined): string | null {
  if (!input) {
    return '图层数据不能为空';
  }

  if (typeof input.name !== 'string' || input.name.trim() === '') {
    return '图层名称不能为空';
  }

  if (!isLayerType(input.type)) {
    return '图层类型必须是 raster、vector 或 ai-generated';
  }

  if (!isLayerContent(input.content)) {
    return '图层内容必须是 fabric 或 svg 格式';
  }

  if (input.visible !== undefined && typeof input.visible !== 'boolean') {
    return 'visible 必须是布尔值';
  }

  if (
    input.opacity !== undefined &&
    (typeof input.opacity !== 'number' || input.opacity < 0 || input.opacity > 1)
  ) {
    return 'opacity 必须是 0 到 1 之间的数字';
  }

  return null;
}

function validateUpdateLayer(input: LayerUpdateBody): string | null {
  if (input.name !== undefined && typeof input.name !== 'string') {
    return 'name 必须是字符串';
  }

  if (input.visible !== undefined && typeof input.visible !== 'boolean') {
    return 'visible 必须是布尔值';
  }

  if (
    input.opacity !== undefined &&
    (typeof input.opacity !== 'number' || input.opacity < 0 || input.opacity > 1)
  ) {
    return 'opacity 必须是 0 到 1 之间的数字';
  }

  if (input.content !== undefined && !isLayerContent(input.content)) {
    return 'content 必须是 fabric 或 svg 格式';
  }

  return null;
}

function validateApplyAction(input: ApplyActionRequest | undefined): string | null {
  if (!input) {
    return '操作数据不能为空';
  }

  if (input.actor !== 'user' && input.actor !== 'agent') {
    return 'actor 必须是 user 或 agent';
  }

  if (
    input.expectedRevision !== undefined &&
    !Number.isInteger(input.expectedRevision)
  ) {
    return 'expectedRevision 必须是整数';
  }

  const action = input.action as unknown;

  if (!action || typeof action !== 'object') {
    return 'action 不能为空';
  }

  const candidate = action as {
    type?: unknown;
    layer?: unknown;
    layerId?: unknown;
    patch?: unknown;
  };

  switch (candidate.type) {
    case 'canvas_create_layer':
      return validateCreateLayer(candidate.layer as LayerCreateBody | undefined);

    case 'canvas_update_layer': {
      if (typeof candidate.layerId !== 'string' || candidate.layerId.length === 0) {
        return 'layerId 不能为空';
      }

      return validateUpdateLayer((candidate.patch ?? {}) as LayerUpdateBody);
    }

    case 'canvas_delete_layer':
      if (typeof candidate.layerId !== 'string' || candidate.layerId.length === 0) {
        return 'layerId 不能为空';
      }

      return null;

    default:
      return 'action.type 必须是 canvas_create_layer、canvas_update_layer 或 canvas_delete_layer';
  }
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

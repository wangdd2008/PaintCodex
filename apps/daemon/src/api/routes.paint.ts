import type { FastifyInstance } from 'fastify';
import type { CreateCanvasRequest } from '@paintcodex/protocol';
import { MAX_CANVAS_DIMENSION, type PaintService } from '../paint/service.js';

export function registerPaintRoutes(app: FastifyInstance, service: PaintService): void {
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

function isValidDimension(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= MAX_CANVAS_DIMENSION
  );
}

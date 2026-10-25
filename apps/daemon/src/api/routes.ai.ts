import type { FastifyInstance } from 'fastify';
import type { AiChatRequest, Layer } from '@paintcodex/protocol';
import { CommandDispatcher } from '../paint/command-dispatcher.js';
import { RevisionConflictError } from '../paint/errors.js';
import type { PaintService } from '../paint/service.js';
import type { CodexRunner } from '../paint/agent/codex-runner.js';
import { buildAiChatPrompt } from '../paint/agent/prompt.js';
import {
  CANVAS_ACTION_MARKER,
  parseCanvasAction,
  type CanvasAction,
} from '../paint/agent/canvas-action.js';

export function registerAiChatRoute(
  app: FastifyInstance,
  runner: CodexRunner,
  dispatcher: CommandDispatcher,
  service: PaintService,
): void {
  app.post('/paint/ai/chat', async (request, reply) => {
    const body: unknown = request.body;

    if (!isAiChatRequest(body)) {
      return reply.code(400).send({
        error: {
          code: 'invalid_request',
          message: 'message is required',
        },
      });
    }

    const canvas = body.canvasId ? service.getCanvas(body.canvasId) : null;

    reply.hijack();
    const response = reply.raw;

    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });

    const controller = new AbortController();
    const onClose = () => {
      if (!response.writableEnded) {
        controller.abort();
      }
    };
    response.on('close', onClose);

    const send = (payload: unknown) => {
      if (response.writableEnded || response.destroyed) {
        return;
      }

      try {
        response.write(`data: ${JSON.stringify(payload)}\n\n`);
      } catch {
        // The client disconnected; the close handler aborts the runner.
      }
    };

    let assistantText = '';

    try {
      await runner.run(
        buildAiChatPrompt(body.message, {
          canvasId: body.canvasId,
          canvas: canvas
            ? {
                id: canvas.id,
                width: canvas.width,
                height: canvas.height,
                layers: canvas.layers.map((layer) => ({
                  name: layer.name,
                  type: layer.type,
                })),
              }
            : undefined,
        }),
        (delta) => {
          assistantText += delta;
          send({ delta });
        },
        controller.signal,
      );

      const action = parseCanvasAction(assistantText);

      if (action) {
        if (!canvas) {
          send({
            error: {
              code: 'canvas_required',
              message: 'Open a canvas before asking the AI to draw.',
            },
          });
        } else {
          try {
            const layer = applyCanvasAction(
              dispatcher,
              service,
              canvas.id,
              action,
              body.message,
            );
            send({ layerCreated: { id: layer.id, name: layer.name } });
          } catch (error) {
            send({
              error: {
                code: 'ai_canvas_action_failed',
                message: errorMessage(error),
              },
            });
          }
        }
      } else if (assistantText.includes(CANVAS_ACTION_MARKER)) {
        send({
          error: {
            code: 'ai_canvas_action_invalid',
            message: 'The AI returned an invalid canvas action.',
          },
        });
      }

      send({ done: true });
    } catch (error) {
      if (!controller.signal.aborted) {
        send({
          error: {
            code: 'ai_chat_failed',
            message: errorMessage(error),
          },
        });
      }
    } finally {
      response.off('close', onClose);

      if (!response.writableEnded && !response.destroyed) {
        response.end();
      }
    }
  });
}

const MAX_ACTION_RETRIES = 1;

function applyCanvasAction(
  dispatcher: CommandDispatcher,
  service: PaintService,
  canvasId: string,
  action: CanvasAction,
  prompt: string,
): Layer {
  let attempt = 0;

  for (;;) {
    const current = service.getCanvas(canvasId);

    if (!current) {
      throw new Error('Canvas not found');
    }

    try {
      const updated = dispatcher.dispatch(canvasId, {
        actor: 'agent',
        expectedRevision: current.revision,
        action: {
          type: 'canvas_create_layer',
          layer: {
            name: action.name,
            type: 'ai-generated',
            content: { kind: 'svg', svg: action.svg },
            metadata: { prompt },
          },
        },
      });

      const created = updated.layers[updated.layers.length - 1];

      if (!created) {
        throw new Error('The AI layer was not created');
      }

      return created;
    } catch (error) {
      if (error instanceof RevisionConflictError && attempt < MAX_ACTION_RETRIES) {
        attempt += 1;
        continue;
      }

      throw error;
    }
  }
}

function isAiChatRequest(value: unknown): value is AiChatRequest {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as { message?: unknown; canvasId?: unknown };

  if (typeof candidate.message !== 'string' || candidate.message.trim().length === 0) {
    return false;
  }

  return candidate.canvasId === undefined || typeof candidate.canvasId === 'string';
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'AI chat request failed';
  return message.slice(0, 1000);
}

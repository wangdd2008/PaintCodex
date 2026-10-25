import type { FastifyInstance, FastifyRequest } from 'fastify';
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
import type {
  ObservabilitySpan,
  SpanFinishInput,
} from '../observability/logger.js';
import { getRequestSpan } from '../observability/request-context.js';

/** User-facing progress labels; the SSE step id is the table key so the two cannot drift. */
const AI_CHAT_STEPS = {
  prompt_built: '正在构建请求…',
  codex_exec: 'AI 正在思考…',
  action_parse: '正在解析结果…',
  action_apply: '正在应用到画布…',
} as const;

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
          message: 'message 不能为空',
        },
      });
    }

    const canvas = body.canvasId ? service.getCanvas(body.canvasId) : null;
    const chatSpan = startChatSpan(app, request, body.canvasId, canvas !== null);
    let deltaCount = 0;
    let actionApplied = false;
    let failure: string | null = null;
    let errorSent = false;

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

    const sendStep = (id: keyof typeof AI_CHAT_STEPS) => {
      send({ step: { id, label: AI_CHAT_STEPS[id] } });
    };

    const sendError = (code: string, message: string) => {
      failure = message;
      errorSent = true;
      send({ error: { code, message } });
    };

    let assistantText = '';

    try {
      const prompt = buildAiChatPrompt(body.message, {
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
      });

      chatSpan.log({
        level: 'debug',
        message: 'prompt_built',
        payload: {
          promptLength: prompt.length,
          hasCanvas: canvas !== null,
          layerCount: canvas?.layers.length ?? 0,
        },
      });
      sendStep('prompt_built');

      const codexSpan = chatSpan.startSpan({
        category: 'ai-chat',
        message: 'codex_exec',
        payload: { promptLength: prompt.length },
      });
      // Emitted as the span starts: the CLI is a black box, so this is the
      // only progress signal until it exits.
      sendStep('codex_exec');

      try {
        await runner.run(
          prompt,
          (delta) => {
            deltaCount += 1;
            assistantText += delta;
            send({ delta });
          },
          controller.signal,
          codexSpan,
        );
      } catch (error) {
        codexSpan.finish({ level: 'error', error });
        throw error;
      }

      codexSpan.finish({
        level: 'info',
        payload: {
          deltaCount,
          outputLength: assistantText.length,
        },
      });

      const action = parseCanvasAction(assistantText);

      chatSpan.log({
        level: 'debug',
        message: 'action_parse',
        payload: {
          hasAction: action !== null,
          actionName: action?.name,
          invalidMarker:
            action === null && assistantText.includes(CANVAS_ACTION_MARKER),
        },
      });
      sendStep('action_parse');

      if (action) {
        if (!canvas) {
          sendError(
            'canvas_required',
            '请先打开画布再让 AI 绘制。'
          );
        } else {
          // The span is only finished on success so `action_apply` always
          // carries the id of the layer that was actually created.
          const applySpan = chatSpan.startSpan({
            category: 'ai-chat',
            message: 'action_apply',
            payload: { actionName: action.name, canvasId: canvas.id },
          });
          sendStep('action_apply');

          try {
            const layer = applyCanvasAction(
              dispatcher,
              service,
              canvas.id,
              action,
              body.message,
            );
            applySpan.finish({
              level: 'info',
              payload: { layerId: layer.id, actionName: action.name },
            });
            actionApplied = true;
            send({ layerCreated: { id: layer.id, name: layer.name } });
          } catch (error) {
            applySpan.finish({
              level: 'error',
              error,
              payload: { actionName: action.name, canvasId: canvas.id },
            });
            sendError('ai_canvas_action_failed', errorMessage(error));
          }
        }
      } else if (assistantText.includes(CANVAS_ACTION_MARKER)) {
        sendError(
          'ai_canvas_action_invalid',
          'AI 返回了无效的画布操作。'
        );
      }

      send({ done: true });
    } catch (error) {
      if (!controller.signal.aborted) {
        sendError('ai_chat_failed', errorMessage(error));
      }
    } finally {
      response.off('close', onClose);

      const aborted = controller.signal.aborted;
      const summary = {
        deltaCount,
        assistantLength: assistantText.length,
        actionApplied,
        aborted,
      };

      chatSpan.log({
        level: aborted ? 'warn' : 'info',
        message: 'sse_complete',
        payload: summary,
      });

      if (!response.writableEnded && !response.destroyed) {
        response.end();
      }

      const finishInput: SpanFinishInput = {
        level: aborted ? 'warn' : errorSent ? 'error' : 'info',
        message: 'chat_completed',
        payload: summary,
      };

      if (!aborted && errorSent) {
        finishInput.error = failure;
      }

      chatSpan.finish(finishInput);
    }
  });
}

function startChatSpan(
  app: FastifyInstance,
  request: FastifyRequest,
  canvasId: string | undefined,
  hasCanvas: boolean,
): ObservabilitySpan {
  const start = {
    category: 'ai-chat' as const,
    message: 'ai_chat',
    payload: { hasCanvas },
    canvasId: canvasId ?? null,
    actor: 'agent' as const,
  };
  const parent = getRequestSpan(request);

  return parent ? parent.startSpan(start) : app.observability.startTrace(start);
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
      throw new Error('画布不存在');
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
  const message = error instanceof Error ? error.message : 'AI 对话请求失败';
  return message.slice(0, 1000);
}

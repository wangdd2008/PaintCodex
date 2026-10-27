import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AiChatRequest, AiRenderResultRequest } from '@paintcodex/protocol';
import type { PaintService } from '../paint/service.js';
import {
  EMPTY_CANVAS_TOOLS,
  type CanvasToolSet,
} from '../paint/agent/runtime/tools.js';
import type { CodexRuntime } from '../paint/agent/runtime/codex-runtime.js';
import {
  MAX_RENDER_IMAGE_BYTES,
  type RenderPreviewChannel,
} from '../paint/agent/runtime/render-preview.js';
import { buildAiChatPrompt } from '../paint/agent/prompt.js';
import type {
  ObservabilitySpan,
  SpanFinishInput,
} from '../observability/logger.js';
import { getRequestSpan } from '../observability/request-context.js';

export function registerAiChatRoute(
  app: FastifyInstance,
  runtime: CodexRuntime,
  tools: CanvasToolSet,
  service: PaintService,
  renderChannel?: RenderPreviewChannel,
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
        // The client disconnected; the close handler aborts the turn.
      }
    };

    const sendError = (code: string, message: string) => {
      failure = message;
      errorSent = true;
      send({ error: { code, message } });
    };

    // Render requests belong to this stream: the browser listens on it and
    // answers on a separate HTTP request, correlated by the id it just saw.
    const renderTurn = renderChannel?.beginTurn((request) => {
      send({ renderRequest: request });
    });

    let assistantText = '';

    try {
      const prompt = buildAiChatPrompt(body.message, {
        canvasId: body.canvasId,
        canvas: canvas
          ? {
              id: canvas.id,
              width: canvas.width,
              height: canvas.height,
              revision: canvas.revision,
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

      const turnSpan = chatSpan.startSpan({
        category: 'ai-chat',
        message: 'codex_turn',
        payload: { promptLength: prompt.length, hasCanvas: canvas !== null },
        canvasId: canvas?.id ?? null,
      });

      try {
        const result = await runtime.startTurn({
          canvasId: canvas?.id ?? null,
          prompt,
          userMessage: body.message,
          // Without a canvas the agent has nothing it may touch; declaring no
          // tools keeps canvas ids from other conversations out of reach.
          tools: canvas ? tools : EMPTY_CANVAS_TOOLS,
          signal: controller.signal,
          trace: turnSpan,
          ...(renderTurn === undefined ? {} : { requestRender: renderTurn.request }),
          onNotice: (notice) => {
            send({ notice });
          },
          onDelta: (delta) => {
            deltaCount += 1;
            assistantText += delta;
            send({ delta });
          },
          onLayerCreated: (layer) => {
            actionApplied = true;
            send({ layerCreated: { id: layer.id, name: layer.name } });
          },
          onToolEvent: (event) => {
            send({ tool: event });
          },
        });

        turnSpan.finish({
          level: 'info',
          payload: {
            deltaCount,
            outputLength: assistantText.length,
            toolCallCount: result.toolCallCount,
          },
        });
      } catch (error) {
        turnSpan.finish({ level: 'error', error });
        throw error;
      }

      send({ done: true });
    } catch (error) {
      if (!controller.signal.aborted) {
        sendError('ai_chat_failed', errorMessage(error));
      }
    } finally {
      // A disconnected stream must not leave a render request pending: the tool
      // would otherwise sit on a browser that is no longer listening.
      renderTurn?.close();
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

/**
 * The browser's half of `canvas_render_preview`: one PNG data URL per pending
 * request id. The route accepts a single image and rejects anything above the
 * cap, a stale id, or a body that is not a PNG data URL.
 */
export function registerRenderResultRoute(
  app: FastifyInstance,
  channel: RenderPreviewChannel,
): void {
  app.post<{ Body: unknown }>(
    '/paint/ai/render-result',
    // Room for the JSON envelope plus one capped data URL; the image cap
    // itself is enforced on the string so the reply is a structured error.
    { bodyLimit: MAX_RENDER_IMAGE_BYTES + 1024 * 1024 },
    async (request, reply) => {
      if (!isRenderResultRequest(request.body)) {
        return reply.code(400).send({
          error: {
            code: 'invalid_render_result',
            message: 'requestId 与 imageUrl 不能为空',
          },
        });
      }

      const delivery = channel.deliver(
        request.body.requestId,
        request.body.imageUrl,
      );

      switch (delivery.status) {
        case 'accepted':
          return reply.code(204).send();
        case 'unknown':
          return reply.code(409).send({
            error: {
              code: 'render_request_unknown',
              message: '渲染请求不存在或这一轮已经结束',
            },
          });
        case 'invalid':
          return reply.code(400).send({
            error: {
              code: 'invalid_render_result',
              message: '预览必须是 PNG data URL',
            },
          });
        case 'too_large':
          return reply.code(413).send({
            error: {
              code: 'render_image_too_large',
              message: `预览图片不能超过 ${delivery.maxBytes} 字节`,
            },
          });
      }
    },
  );
}

function isRenderResultRequest(value: unknown): value is AiRenderResultRequest {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as { requestId?: unknown; imageUrl?: unknown };

  return (
    typeof candidate.requestId === 'string' &&
    candidate.requestId.length > 0 &&
    typeof candidate.imageUrl === 'string' &&
    candidate.imageUrl.length > 0
  );
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

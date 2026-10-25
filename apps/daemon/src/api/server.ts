import Fastify, { type FastifyInstance } from 'fastify';
import type { AiChatRequest } from '@paintcodex/protocol';
import { createCodexRunner, type CodexRunner } from '../paint/agent/codex-runner.js';
import { buildAiChatPrompt } from '../paint/agent/prompt.js';

export interface BuildServerOptions {
  /** Injectable Codex seam; tests pass a fake so no CLI is spawned. */
  runner?: CodexRunner;
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

export function buildServer(options: BuildServerOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const runner = options.runner ?? createCodexRunner();

  app.get('/health', async () => ({ ok: true }));

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

    try {
      await runner.run(
        buildAiChatPrompt(body.message, body.canvasId),
        (delta) => {
          send({ delta });
        },
        controller.signal,
      );
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

  return app;
}

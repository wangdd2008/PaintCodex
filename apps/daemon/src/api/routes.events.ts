import type { FastifyInstance } from 'fastify';
import type { PaintEvents } from '../paint/events.js';
import type { PaintService } from '../paint/service.js';
import { LOG_DIRECTIONS } from '../observability/log-direction.js';

export function registerEventRoutes(
  app: FastifyInstance,
  service: PaintService,
  events: PaintEvents,
): void {
  app.get<{ Params: { id: string } }>(
    '/paint/canvas/:id/events',
    async (request, reply) => {
      const canvas = service.getCanvas(request.params.id);

      if (!canvas) {
        return reply.code(404).send({
          error: { code: 'canvas_not_found', message: '画布不存在' },
        });
      }

      reply.hijack();

      const stream = reply.raw;
      stream.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      const unsubscribe = events.subscribe(canvas.id, (event, trace) => {
        stream.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        app.observability.log({
          category: 'sse',
          level: 'info',
          message: 'sse_publish',
          canvasId: canvas.id,
          payload: { event: event.type, revision: event.revision },
          // daemon 把画布变更推给浏览器
          source: LOG_DIRECTIONS.ssePublish.source,
          target: LOG_DIRECTIONS.ssePublish.target,
          // 由画布写入触发时，归回发起那次写入的追踪；其他来源（无 trace）保持 NULL。
          traceId: trace?.traceId ?? null,
          parentId: trace?.spanId ?? null,
        });
      });

      const heartbeat = setInterval(() => {
        stream.write(': ping\n\n');
      }, 15_000);

      app.observability.log({
        category: 'sse',
        level: 'info',
        message: 'sse_subscribe',
        canvasId: canvas.id,
        payload: { canvasId: canvas.id },
        // 浏览器订阅 daemon 的事件流
        source: LOG_DIRECTIONS.sseSubscribe.source,
        target: LOG_DIRECTIONS.sseSubscribe.target,
      });
      stream.write(': connected\n\n');

      request.raw.on('close', () => {
        clearInterval(heartbeat);
        unsubscribe();

        // Disconnect telemetry is best-effort: during shutdown the database can
        // close before the client socket finishes tearing down.
        try {
          app.observability.log({
            category: 'sse',
            level: 'info',
            message: 'sse_disconnect',
            canvasId: canvas.id,
            // 浏览器断开了到 daemon 的长连接
            source: LOG_DIRECTIONS.sseDisconnect.source,
            target: LOG_DIRECTIONS.sseDisconnect.target,
          });
        } catch {
          // The stream is already gone; losing this record must not crash the daemon.
        }
      });
    },
  );
}

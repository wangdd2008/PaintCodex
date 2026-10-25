import type { FastifyInstance } from 'fastify';
import type { PaintEvents } from '../paint/events.js';
import type { PaintService } from '../paint/service.js';

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
          error: { code: 'canvas_not_found', message: 'Canvas not found' },
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

      const unsubscribe = events.subscribe(canvas.id, (event) => {
        stream.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      });

      const heartbeat = setInterval(() => {
        stream.write(': ping\n\n');
      }, 15_000);

      stream.write(': connected\n\n');

      request.raw.on('close', () => {
        clearInterval(heartbeat);
        unsubscribe();
      });
    },
  );
}

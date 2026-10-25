import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import type { LogLevel } from '@paintcodex/protocol';
import { registerAiChatRoute } from './routes.ai.js';
import { registerEventRoutes } from './routes.events.js';
import { registerMonitorRoutes } from './routes.monitor.js';
import { registerPaintRoutes } from './routes.paint.js';
import { createCodexRunner, type CodexRunner } from '../paint/agent/codex-runner.js';
import { CommandDispatcher } from '../paint/command-dispatcher.js';
import { PaintEvents } from '../paint/events.js';
import {
  CanvasRepository,
  LayerRepository,
  SnapshotRepository,
} from '../paint/repository.js';
import { PaintService } from '../paint/service.js';
import { openDatabase } from '../storage/database.js';
import {
  clearRequestSpan,
  createObservability,
  getRequestSpan,
  setRequestSpan,
  type ObservabilityLogger,
} from '../observability/index.js';

declare module 'fastify' {
  interface FastifyInstance {
    observability: ObservabilityLogger;
  }
}

export interface ServerOptions {
  dbPath?: string;
  logger?: boolean;
  /** Injectable Codex seam; tests pass a fake so no CLI is spawned. */
  runner?: CodexRunner;
}

export function defaultDbPath(): string {
  return process.env.PAINTCODEX_DB ?? join(process.cwd(), 'data', 'paintcodex.db');
}

export function buildServer(options: ServerOptions = {}): FastifyInstance {
  const dbPath = options.dbPath ?? defaultDbPath();
  const db = openDatabase(dbPath);
  const events = new PaintEvents();
  const observability = createObservability(db);
  const service = new PaintService(
    new CanvasRepository(db),
    new LayerRepository(db),
    new SnapshotRepository(db),
    events,
    observability.logger,
  );
  const app = Fastify({ logger: options.logger ?? false });
  const runner =
    options.runner ?? createCodexRunner({ logger: observability.logger });
  const dispatcher = new CommandDispatcher(service);

  app.decorate('observability', observability.logger);

  app.addHook('onRequest', async (request) => {
    if (!shouldLogHttpRequest(request.url)) {
      return;
    }

    const span = app.observability.startTrace({
      category: 'http',
      message: 'http_request',
      payload: { method: request.method, path: request.url },
    });

    setRequestSpan(request, span);
  });

  app.addHook('onResponse', async (request, reply) => {
    const span = getRequestSpan(request);

    if (!span) {
      return;
    }

    span.finish({
      level: levelForStatus(reply.statusCode),
      payload: {
        method: request.method,
        path: request.url,
        statusCode: reply.statusCode,
      },
    });
    clearRequestSpan(request);
  });

  app.addHook('onClose', async () => {
    db.close();
  });

  app.get('/health', async () => ({ ok: true }));
  registerPaintRoutes(app, service);
  registerEventRoutes(app, service, events);
  registerAiChatRoute(app, runner, dispatcher, service);
  registerMonitorRoutes(app, observability);

  return app;
}

const MONITOR_EVENTS_PATH = '/monitor/events';

/**
 * The monitor SSE stream is long-lived, so logging its request would create a
 * span that only finishes when the client disconnects.
 */
export function shouldLogHttpRequest(url: string): boolean {
  const queryIndex = url.indexOf('?');
  const path = queryIndex === -1 ? url : url.slice(0, queryIndex);

  return path !== MONITOR_EVENTS_PATH;
}

/** Maps an HTTP status code onto the log level used for its request record. */
function levelForStatus(statusCode: number): LogLevel {
  if (statusCode >= 500) {
    return 'error';
  }

  if (statusCode >= 400) {
    return 'warn';
  }

  return 'info';
}

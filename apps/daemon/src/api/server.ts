import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import type { LogLevel } from '@paintcodex/protocol';
import {
  registerAiChatRoute,
  registerAiConfirmRoute,
  registerRenderResultRoute,
} from './routes.ai.js';
import { registerEventRoutes } from './routes.events.js';
import { registerMonitorRoutes } from './routes.monitor.js';
import { registerPaintRoutes } from './routes.paint.js';
import {
  createCodexRuntime,
  type CodexRuntime,
  type CodexThreadStore,
  type CodexVersionProbe,
} from '../paint/agent/runtime/codex-runtime.js';
import {
  createConfirmationChannel,
  type ConfirmationChannel,
} from '../paint/agent/runtime/confirmation.js';
import { createCanvasToolSet } from '../paint/agent/runtime/tools.js';
import {
  createRenderPreviewChannel,
  type RenderPreviewChannel,
} from '../paint/agent/runtime/render-preview.js';
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
  runtime?: CodexRuntime;
  /** Injectable version gate; tests pin it without a Codex install. */
  codexVersion?: CodexVersionProbe;
  /** Injectable confirmation seam; tests open and answer requests directly. */
  confirmations?: ConfirmationChannel;
  /** Injectable preview broker; tests pin request ids and the image cap. */
  renderChannel?: RenderPreviewChannel;
}

export function defaultDbPath(): string {
  return process.env.PAINTCODEX_DB ?? join(process.cwd(), 'data', 'paintcodex.db');
}

export function buildServer(options: ServerOptions = {}): FastifyInstance {
  const dbPath = options.dbPath ?? defaultDbPath();
  const db = openDatabase(dbPath);
  const events = new PaintEvents();
  const observability = createObservability(db);
  const canvases = new CanvasRepository(db);
  const service = new PaintService(
    canvases,
    new LayerRepository(db),
    new SnapshotRepository(db),
    events,
    observability.logger,
  );
  const app = Fastify({ logger: options.logger ?? false });
  const dispatcher = new CommandDispatcher(service);
  const tools = createCanvasToolSet({
    dispatcher,
    service,
    logger: observability.logger,
  });
  // `codex app-server`'s protocol is experimental: the daemon entry point pins
  // the CLI floor at startup and refuses to register the AI route instead of
  // failing on the first chat. Tests inject either the probe or a runtime.
  const codexVersion: CodexVersionProbe = options.runtime
    ? {
        available: true,
        version:
          options.codexVersion?.available === true
            ? options.codexVersion.version
            : 'injected',
      }
    : (options.codexVersion ?? { available: true, version: 'unknown' });
  const confirmations: ConfirmationChannel =
    options.confirmations ??
    createConfirmationChannel({ logger: observability.logger });
  const canvasThreads: CodexThreadStore = {
    load: (canvasId) => canvases.findById(canvasId)?.codexThreadId ?? null,
    save: (canvasId, threadId) => canvases.setCodexThreadId(canvasId, threadId),
    clear: (canvasId) => canvases.setCodexThreadId(canvasId, null),
  };
  const runtime =
    options.runtime ??
    (codexVersion.available
      ? createCodexRuntime({
          logger: observability.logger,
          confirmations,
          threadStore: canvasThreads,
        })
      : null);
  const renderChannel = options.renderChannel ?? createRenderPreviewChannel();

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
    await runtime?.close();

    // An injected channel belongs to the test; only close the one we created.
    if (!options.confirmations) {
      confirmations.close();
    }

    db.close();
  });

  app.get('/health', async () => ({
    ok: true,
    ai: codexVersion.available
      ? { available: true, version: codexVersion.version }
      : { available: false, reason: codexVersion.reason },
  }));
  registerPaintRoutes(app, service);
  registerEventRoutes(app, service, events);

  if (runtime) {
    registerAiChatRoute(app, runtime, tools, service, renderChannel);
    registerAiConfirmRoute(app, confirmations);
    registerRenderResultRoute(app, renderChannel);
  }

  registerMonitorRoutes(app, observability);

  return app;
}

const MONITOR_EVENTS_PATH = '/monitor/events';

/**
 * The monitor SSE stream is long-lived, so logging its request would create a
 * span that only finishes when the client disconnects — and publishing that
 * record back into the stream would feed itself. Every other request is
 * logged, including the rest of `/monitor/*`: those records are evidence the
 * operator can read. Stats aggregation is what ignores monitor requests, so
 * the monitor never measures its own polling.
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

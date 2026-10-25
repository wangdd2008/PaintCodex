import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerAiChatRoute } from './routes.ai.js';
import { registerEventRoutes } from './routes.events.js';
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
  const db = openDatabase(options.dbPath ?? defaultDbPath());
  const events = new PaintEvents();
  const service = new PaintService(
    new CanvasRepository(db),
    new LayerRepository(db),
    new SnapshotRepository(db),
    events,
  );
  const app = Fastify({ logger: options.logger ?? false });
  const runner = options.runner ?? createCodexRunner();
  const dispatcher = new CommandDispatcher(service);

  app.addHook('onClose', async () => {
    db.close();
  });

  app.get('/health', async () => ({ ok: true }));
  registerPaintRoutes(app, service);
  registerEventRoutes(app, service, events);
  registerAiChatRoute(app, runner, dispatcher, service);

  return app;
}

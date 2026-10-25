import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerPaintRoutes } from './routes.paint.js';
import { CanvasRepository, LayerRepository } from '../paint/repository.js';
import { PaintService } from '../paint/service.js';
import { openDatabase } from '../storage/database.js';

export interface ServerOptions {
  dbPath?: string;
  logger?: boolean;
}

export function defaultDbPath(): string {
  return process.env.PAINTCODEX_DB ?? join(process.cwd(), 'data', 'paintcodex.db');
}

export function buildServer(options: ServerOptions = {}): FastifyInstance {
  const db = openDatabase(options.dbPath ?? defaultDbPath());
  const service = new PaintService(
    new CanvasRepository(db),
    new LayerRepository(db),
  );
  const app = Fastify({ logger: options.logger ?? false });

  app.addHook('onClose', async () => {
    db.close();
  });

  app.get('/health', async () => ({ ok: true }));
  registerPaintRoutes(app, service);

  return app;
}

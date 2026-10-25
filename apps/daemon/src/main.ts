import { buildServer } from './api/server.js';

const port = Number(process.env.PORT ?? 3210);
const host = process.env.HOST ?? '127.0.0.1';

const app = buildServer();

app.observability.log({
  category: 'system',
  message: 'db_migrated',
  payload: { ready: true },
});

async function shutdown(signal: string) {
  app.log.info(`received ${signal}, shutting down`);
  app.observability.log({
    category: 'system',
    message: 'daemon_stopped',
    payload: { signal },
  });
  await app.close();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ port, host });
  app.observability.log({
    category: 'system',
    message: 'daemon_started',
    payload: { port, host },
  });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

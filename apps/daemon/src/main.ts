import { buildServer } from './api/server.js';
import { probeCodexVersion } from './paint/agent/runtime/codex-runtime.js';

const port = Number(process.env.PORT ?? 3210);
const host = process.env.HOST ?? '127.0.0.1';

// The app-server protocol is experimental, so the CLI floor is checked before
// the daemon starts serving: an old CLI disables the AI route with a reason
// `/health` can report, rather than failing on the first conversation.
const codexVersion = probeCodexVersion();
const app = buildServer({ codexVersion });

app.observability.log({
  category: 'system',
  message: 'db_migrated',
  payload: { ready: true },
});

app.observability.log({
  category: 'system',
  level: codexVersion.available ? 'info' : 'warn',
  message: codexVersion.available ? 'ai_route_ready' : 'ai_route_disabled',
  payload: codexVersion.available
    ? { codexVersion: codexVersion.version }
    : { reason: codexVersion.reason },
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

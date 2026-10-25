import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer, shouldLogHttpRequest } from '../src/api/server.js';

const openApps: FastifyInstance[] = [];

function createApp(): FastifyInstance {
  const app = buildServer({ dbPath: ':memory:' });
  openApps.push(app);

  return app;
}

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

describe('HTTP instrumentation', () => {
  it('records one http span for a successful request', async () => {
    const app = createApp();

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);

    const page = app.observability.repository.query({ category: 'http' });

    expect(page.total).toBe(1);
    expect(page.items).toHaveLength(1);

    const log = page.items.at(0);

    if (!log) {
      throw new Error('expected one http log record');
    }

    expect(log.category).toBe('http');
    expect(log.message).toBe('http_request');
    expect(log.payload).toEqual({
      method: 'GET',
      path: '/health',
      statusCode: 200,
    });
    expect(typeof log.durationMs).toBe('number');
    expect(log.durationMs).toBeGreaterThanOrEqual(0);
    expect(log.traceId).toBeTruthy();
    expect(log.spanId).toBeTruthy();
  });

  it('logs a not-found response at warn level', async () => {
    const app = createApp();

    const response = await app.inject({
      method: 'GET',
      url: '/paint/canvas/missing',
    });

    expect(response.statusCode).toBe(404);

    const page = app.observability.repository.query({ category: 'http' });

    expect(page.total).toBe(1);
    expect(page.items[0]).toMatchObject({
      level: 'warn',
      payload: {
        method: 'GET',
        path: '/paint/canvas/missing',
        statusCode: 404,
      },
    });
  });

  it('logs a server failure at error level', async () => {
    const app = createApp();

    app.get('/boom', async () => {
      throw new Error('boom');
    });

    const response = await app.inject({ method: 'GET', url: '/boom' });

    expect(response.statusCode).toBe(500);

    const page = app.observability.repository.query({ category: 'http' });

    expect(page.items[0]).toMatchObject({
      level: 'error',
      payload: { method: 'GET', path: '/boom', statusCode: 500 },
    });
  });
});

describe('shouldLogHttpRequest', () => {
  it('skips the monitor SSE endpoint but logs other requests', () => {
    expect(shouldLogHttpRequest('/monitor/events')).toBe(false);
    expect(shouldLogHttpRequest('/monitor/events?probe=1')).toBe(false);
    expect(shouldLogHttpRequest('/health')).toBe(true);
  });
});

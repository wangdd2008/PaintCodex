import { afterAll, describe, expect, it } from 'vitest';
import { buildServer } from '../src/api/server.js';

describe('daemon health endpoint', () => {
  const app = buildServer();

  afterAll(async () => {
    await app.close();
  });

  it('reports the daemon as healthy', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });
});

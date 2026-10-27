import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/api/server.js';

describe('daemon health endpoint', () => {
  it('reports the daemon and AI availability with the Codex version', async () => {
    const app = buildServer({
      dbPath: ':memory:',
      codexVersion: { available: true, version: '0.164.0' },
    });

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      ai: { available: true, version: '0.164.0' },
    });

    await app.close();
  });

  it('reports the gate reason and does not register the AI route for an old CLI', async () => {
    const reason =
      'codex CLI 版本过低（当前 0.160.5，需要 0.164.0 或更高版本）。请运行 npm install -g @openai/codex@latest 升级。';
    const app = buildServer({
      dbPath: ':memory:',
      codexVersion: { available: false, reason },
    });

    const health = await app.inject({ method: 'GET', url: '/health' });
    const chat = await app.inject({
      method: 'POST',
      url: '/paint/ai/chat',
      payload: { message: 'Hello' },
    });

    expect(health.json()).toEqual({
      ok: true,
      ai: { available: false, reason },
    });
    expect(chat.statusCode).toBe(404);

    await app.close();
  });

  it('treats an injected runtime as available regardless of the probe', async () => {
    const app = buildServer({
      dbPath: ':memory:',
      codexVersion: { available: false, reason: 'no cli' },
      runtime: {
        async startTurn() {
          return { text: '', toolCallCount: 0 };
        },
        async interrupt() {},
        getThreadId: () => null,
        getActiveTurn: () => null,
        async deleteThread() {},
        async close() {},
      },
    });

    const health = await app.inject({ method: 'GET', url: '/health' });

    expect(health.json()).toMatchObject({ ok: true, ai: { available: true } });

    await app.close();
  });
});

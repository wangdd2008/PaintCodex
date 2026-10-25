import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/api/server.js';
import type { CodexRunner } from '../src/paint/agent/codex-runner.js';

describe('POST /paint/ai/chat', () => {
  it('streams assistant deltas and a final done event', async () => {
    let receivedPrompt = '';
    const runner: CodexRunner = {
      run: async (prompt, onDelta) => {
        receivedPrompt = prompt;
        onDelta('Hello');
        onDelta(' from Codex');
        return 'Hello from Codex';
      },
    };
    const app = buildServer({ runner, dbPath: ':memory:' });

    const response = await app.inject({
      method: 'POST',
      url: '/paint/ai/chat',
      payload: { message: 'Hello', canvasId: 'canvas-1' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.payload).toBe(
      'data: {"delta":"Hello"}\n\ndata: {"delta":" from Codex"}\n\ndata: {"done":true}\n\n',
    );
    expect(receivedPrompt).toContain('painting assistant');
    expect(receivedPrompt).toContain('Hello');
    expect(receivedPrompt).toContain('canvas-1');

    await app.close();
  });

  it('rejects a request without a message and never runs the runner', async () => {
    let called = false;
    const runner: CodexRunner = {
      run: async () => {
        called = true;
        return '';
      },
    };
    const app = buildServer({ runner, dbPath: ':memory:' });

    const response = await app.inject({
      method: 'POST',
      url: '/paint/ai/chat',
      payload: { canvasId: 'canvas-1' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: {
        code: 'invalid_request',
        message: 'message is required',
      },
    });
    expect(called).toBe(false);

    await app.close();
  });

  it('streams an error event when the runner fails', async () => {
    const runner: CodexRunner = {
      run: async () => {
        throw new Error('codex exploded');
      },
    };
    const app = buildServer({ runner, dbPath: ':memory:' });

    const response = await app.inject({
      method: 'POST',
      url: '/paint/ai/chat',
      payload: { message: 'Hello' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.payload).toBe(
      'data: {"error":{"code":"ai_chat_failed","message":"codex exploded"}}\n\n',
    );

    await app.close();
  });
});

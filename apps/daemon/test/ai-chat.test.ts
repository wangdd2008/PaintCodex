import { describe, expect, it } from 'vitest';
import { CANVAS_ACTION_MARKER } from '@paintcodex/protocol';
import { buildServer } from '../src/api/server.js';
import type { CodexRunner } from '../src/paint/agent/codex-runner.js';

const STEP_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';

/** Every SSE frame body, decoded in stream order. */
function frames(payload: string): Record<string, unknown>[] {
  return payload
    .split('\n\n')
    .filter((frame) => frame.trim().length > 0)
    .map((frame) => JSON.parse(frame.replace(/^data: /, '')) as Record<string, unknown>);
}

function stepEvents(payload: string): unknown[] {
  return frames(payload)
    .filter((frame) => frame.step !== undefined)
    .map((frame) => frame.step);
}

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
      'data: {"step":{"id":"prompt_built","label":"正在构建请求…"}}\n\n' +
        'data: {"step":{"id":"codex_exec","label":"AI 正在思考…"}}\n\n' +
        'data: {"delta":"Hello"}\n\n' +
        'data: {"delta":" from Codex"}\n\n' +
        'data: {"step":{"id":"action_parse","label":"正在解析结果…"}}\n\n' +
        'data: {"done":true}\n\n',
    );
    expect(receivedPrompt).toContain('painting assistant');
    expect(receivedPrompt).toContain('Hello');
    expect(receivedPrompt).toContain('canvas-1');

    await app.close();
  });

  it('streams step events for prompt, codex, parse and apply in order', async () => {
    const actionText = `Drawing that now.\n${CANVAS_ACTION_MARKER}\n${JSON.stringify({
      name: 'Steps',
      svg: STEP_SVG,
    })}`;
    const runner: CodexRunner = {
      run: async (_prompt, onDelta) => {
        onDelta(actionText);
        return actionText;
      },
    };
    const app = buildServer({ runner, dbPath: ':memory:' });
    const canvas = await app.inject({
      method: 'POST',
      url: '/paint/canvas',
      payload: {},
    });
    const canvasId = canvas.json().id as string;

    const response = await app.inject({
      method: 'POST',
      url: '/paint/ai/chat',
      payload: { message: 'Draw a square', canvasId },
    });

    expect(stepEvents(response.payload)).toEqual([
      { id: 'prompt_built', label: '正在构建请求…' },
      { id: 'codex_exec', label: 'AI 正在思考…' },
      { id: 'action_parse', label: '正在解析结果…' },
      { id: 'action_apply', label: '正在应用到画布…' },
    ]);
    // No step follows the terminal frame.
    expect(frames(response.payload).at(-1)).toEqual({ done: true });

    await app.close();
  });

  it('does not emit an apply step when the reply changes nothing', async () => {
    const runner: CodexRunner = {
      run: async (_prompt, onDelta) => {
        onDelta('Paris');
        return 'Paris';
      },
    };
    const app = buildServer({ runner, dbPath: ':memory:' });

    const response = await app.inject({
      method: 'POST',
      url: '/paint/ai/chat',
      payload: { message: 'Capital of France?' },
    });

    expect(stepEvents(response.payload)).toEqual([
      { id: 'prompt_built', label: '正在构建请求…' },
      { id: 'codex_exec', label: 'AI 正在思考…' },
      { id: 'action_parse', label: '正在解析结果…' },
    ]);
    expect(frames(response.payload).at(-1)).toEqual({ done: true });

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
        message: 'message 不能为空',
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
    expect(frames(response.payload).at(-1)).toEqual({
      error: { code: 'ai_chat_failed', message: 'codex exploded' },
    });

    await app.close();
  });
});

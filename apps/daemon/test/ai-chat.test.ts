import { describe, expect, it } from 'vitest';
import type { CodexTurnInput } from '../src/paint/agent/runtime/codex-runtime.js';
import { buildServer } from '../src/api/server.js';
import { fakeRuntime } from './helpers/fake-runtime.js';

/** Every SSE frame body, decoded in stream order. */
function frames(payload: string): Record<string, unknown>[] {
  return payload
    .split('\n\n')
    .filter((frame) => frame.trim().length > 0)
    .map((frame) => JSON.parse(frame.replace(/^data: /, '')) as Record<string, unknown>);
}

describe('POST /paint/ai/chat', () => {
  it('streams assistant deltas and a final done event', async () => {
    const captured: { input?: CodexTurnInput } = {};
    const runtime = fakeRuntime(async (input) => {
      input.onDelta('Hello');
      input.onDelta(' from Codex');

      return { text: 'Hello from Codex', toolCallCount: 0 };
    }, captured);
    const app = buildServer({ runtime, dbPath: ':memory:' });

    const response = await app.inject({
      method: 'POST',
      url: '/paint/ai/chat',
      payload: { message: 'Hello', canvasId: 'canvas-1' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.payload).toBe(
      'data: {"delta":"Hello"}\n\n' +
        'data: {"delta":" from Codex"}\n\n' +
        'data: {"done":true}\n\n',
    );
    expect(captured.input?.prompt).toContain('painting assistant');
    expect(captured.input?.prompt).toContain('Hello');
    expect(captured.input?.prompt).toContain('canvas-1');
    expect(captured.input?.userMessage).toBe('Hello');

    await app.close();
  });

  it('sends no step frames and no layerCreated frame for plain conversation', async () => {
    const runtime = fakeRuntime(async (input) => {
      input.onDelta('Paris');

      return { text: 'Paris', toolCallCount: 0 };
    });
    const app = buildServer({ runtime, dbPath: ':memory:' });

    const response = await app.inject({
      method: 'POST',
      url: '/paint/ai/chat',
      payload: { message: 'Capital of France?' },
    });

    expect(frames(response.payload)).toEqual([
      { delta: 'Paris' },
      { done: true },
    ]);
    expect(response.payload).not.toContain('"step"');
    expect(response.payload).not.toContain('layerCreated');

    await app.close();
  });

  it('forwards tool item events as tool frames', async () => {
    const runtime = fakeRuntime(async (input) => {
      input.onToolEvent?.({
        id: 'call-1',
        name: 'canvas_update_layer',
        status: 'running',
      });
      input.onToolEvent?.({
        id: 'call-1',
        name: 'canvas_update_layer',
        status: 'ok',
      });
      input.onToolEvent?.({
        id: 'call-2',
        name: 'canvas_delete_layer',
        status: 'failed',
        code: 'revision_conflict',
      });

      return { text: '', toolCallCount: 2 };
    });
    const app = buildServer({ runtime, dbPath: ':memory:' });

    const response = await app.inject({
      method: 'POST',
      url: '/paint/ai/chat',
      payload: { message: 'Update the circle' },
    });

    expect(frames(response.payload)).toEqual([
      {
        tool: {
          id: 'call-1',
          name: 'canvas_update_layer',
          status: 'running',
        },
      },
      { tool: { id: 'call-1', name: 'canvas_update_layer', status: 'ok' } },
      {
        tool: {
          id: 'call-2',
          name: 'canvas_delete_layer',
          status: 'failed',
          code: 'revision_conflict',
        },
      },
      { done: true },
    ]);

    await app.close();
  });

  it('forwards a suspended tool as a confirm frame', async () => {
    const runtime = fakeRuntime(async (input) => {
      input.onConfirm?.({
        id: 'confirm-1',
        title: '删除图层「红圆」',
        detail: '这是不可逆操作：确认后该图层会从画布上移除。',
      });

      return { text: '', toolCallCount: 1 };
    });
    const app = buildServer({ runtime, dbPath: ':memory:' });

    const response = await app.inject({
      method: 'POST',
      url: '/paint/ai/chat',
      payload: { message: '删掉红圆', canvasId: 'canvas-1' },
    });

    expect(frames(response.payload)).toEqual([
      {
        confirm: {
          id: 'confirm-1',
          title: '删除图层「红圆」',
          detail: '这是不可逆操作：确认后该图层会从画布上移除。',
        },
      },
      { done: true },
    ]);

    await app.close();
  });

  it('declares no canvas tools when the conversation has no canvas', async () => {
    let toolCount = -1;
    const runtime = fakeRuntime(async (input) => {
      toolCount = input.tools.declarations.length;

      return { text: '', toolCallCount: 0 };
    });
    const app = buildServer({ runtime, dbPath: ':memory:' });

    const response = await app.inject({
      method: 'POST',
      url: '/paint/ai/chat',
      payload: { message: 'Hello' },
    });

    expect(response.payload).toContain('"done":true');
    expect(toolCount).toBe(0);

    await app.close();
  });

  it('rejects a request without a message and never starts a turn', async () => {
    let called = false;
    const runtime = fakeRuntime(async () => {
      called = true;

      return { text: '', toolCallCount: 0 };
    });
    const app = buildServer({ runtime, dbPath: ':memory:' });

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

  it('streams an error event when the runtime fails', async () => {
    const runtime = fakeRuntime(async () => {
      throw new Error('codex exploded');
    });
    const app = buildServer({ runtime, dbPath: ':memory:' });

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

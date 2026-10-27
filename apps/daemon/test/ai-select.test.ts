import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/api/server.js';
import { fakeRuntime } from './helpers/fake-runtime.js';

/** Every SSE frame body, decoded in stream order. */
function frames(payload: string): Record<string, unknown>[] {
  return payload
    .split('\n\n')
    .filter((frame) => frame.trim().length > 0)
    .map((frame) => JSON.parse(frame.replace(/^data: /, '')) as Record<string, unknown>);
}

function chatPayload(message = '看我刚画的那一笔') {
  return { message, canvasId: 'canvas-1' };
}

describe('canvas select UI signal', () => {
  it('streams a select frame instead of an answer, then finishes the turn', async () => {
    const runtime = fakeRuntime(async (input) => {
      // The tool's whole effect: no dispatch, no snapshot, just this callback.
      input.onSelect?.({ canvasId: 'canvas-1', layerId: 'layer-1' });
      return { text: '看这里。', toolCallCount: 1 };
    });
    const app = buildServer({ runtime, dbPath: ':memory:' });

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/paint/ai/chat',
        payload: chatPayload(),
      });

      expect(response.statusCode).toBe(200);
      expect(frames(response.payload)).toEqual([
        { select: { canvasId: 'canvas-1', layerId: 'layer-1' } },
        { done: true },
      ]);
    } finally {
      await app.close();
    }
  });

  it('carries a clamped region through unchanged', async () => {
    const runtime = fakeRuntime(async (input) => {
      input.onSelect?.({
        canvasId: 'canvas-1',
        region: { x: 0, y: 500, width: 200, height: 100 },
        clamped: true,
      });
      return { text: '', toolCallCount: 1 };
    });
    const app = buildServer({ runtime, dbPath: ':memory:' });

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/paint/ai/chat',
        payload: chatPayload(),
      });

      expect(frames(response.payload)).toEqual([
        {
          select: {
            canvasId: 'canvas-1',
            region: { x: 0, y: 500, width: 200, height: 100 },
            clamped: true,
          },
        },
        { done: true },
      ]);
    } finally {
      await app.close();
    }
  });
});

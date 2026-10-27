import { describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { buildServer } from '../src/api/server.js';
import {
  createRenderPreviewChannel,
  type RenderPreviewResult,
} from '../src/paint/agent/runtime/render-preview.js';
import { fakeRuntime } from './helpers/fake-runtime.js';

const PNG = 'data:image/png;base64,AAAA';

/** Every SSE frame body, decoded in stream order. */
function frames(payload: string): Record<string, unknown>[] {
  return payload
    .split('\n\n')
    .filter((frame) => frame.trim().length > 0)
    .map((frame) => JSON.parse(frame.replace(/^data: /, '')) as Record<string, unknown>);
}

async function waitFor<T>(probe: () => T | null, timeoutMs = 2_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const value = probe();

    if (value) {
      return value;
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  throw new Error('timed out waiting for the render request');
}

async function waitForAsync<T>(
  probe: () => Promise<T | null>,
  timeoutMs = 2_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const value = await probe();

    if (value) {
      return value;
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  throw new Error('timed out waiting for the render result');
}

function chatPayload(message = '预览一下画布') {
  return { message, canvasId: 'canvas-1' };
}

describe('canvas preview request channel', () => {
  it('streams a renderRequest frame and resolves the tool with the posted image', async () => {
    const channel = createRenderPreviewChannel({ createId: () => 'render-1' });
    let rendered: RenderPreviewResult | undefined;
    const runtime = fakeRuntime(async (input) => {
      rendered = await input.requestRender!('canvas-1');
      return { text: '', toolCallCount: 1 };
    });
    const app = buildServer({ runtime, dbPath: ':memory:', renderChannel: channel });

    try {
      const chat = app.inject({
        method: 'POST',
        url: '/paint/ai/chat',
        payload: chatPayload(),
      });
      const delivery = await waitFor(() => {
        const status = channel.deliver('render-1', PNG);
        return status.status === 'unknown' ? null : status;
      });

      expect(delivery).toEqual({ status: 'accepted' });

      const response = await chat;

      expect(response.statusCode).toBe(200);
      expect(frames(response.payload)).toEqual([
        { renderRequest: { id: 'render-1', canvasId: 'canvas-1' } },
        { done: true },
      ]);
      expect(rendered).toEqual({ ok: true, imageUrl: PNG });
    } finally {
      await app.close();
    }
  });

  it('gives the tool render_unavailable when the browser misses the deadline', async () => {
    const channel = createRenderPreviewChannel({
      createId: () => 'render-1',
      timeoutMs: 20,
    });
    let rendered: RenderPreviewResult | undefined;
    const runtime = fakeRuntime(async (input) => {
      rendered = await input.requestRender!('canvas-1');
      return { text: '', toolCallCount: 1 };
    });
    const app = buildServer({ runtime, dbPath: ':memory:', renderChannel: channel });

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/paint/ai/chat',
        payload: chatPayload(),
      });

      expect(frames(response.payload)).toEqual([
        { renderRequest: { id: 'render-1', canvasId: 'canvas-1' } },
        { done: true },
      ]);
      expect(rendered).toMatchObject({ ok: false, code: 'render_unavailable' });
    } finally {
      await app.close();
    }
  });

  it('rejects a preview image above the size cap with 413', async () => {
    const channel = createRenderPreviewChannel({
      createId: () => 'render-1',
      maxImageBytes: PNG.length,
    });
    let rendered: RenderPreviewResult | undefined;
    const runtime = fakeRuntime(async (input) => {
      rendered = await input.requestRender!('canvas-1');
      return { text: '', toolCallCount: 1 };
    });
    const app = buildServer({ runtime, dbPath: ':memory:', renderChannel: channel });

    try {
      const chat = app.inject({
        method: 'POST',
        url: '/paint/ai/chat',
        payload: chatPayload(),
      });
      const response = await waitForAsync(async () => {
        const post = await app.inject({
          method: 'POST',
          url: '/paint/ai/render-result',
          payload: { requestId: 'render-1', imageUrl: `${PNG}A` },
        });

        return post.statusCode === 409 ? null : post;
      });

      expect(response.statusCode).toBe(413);
      expect(response.json()).toMatchObject({
        error: { code: 'render_image_too_large' },
      });
      await chat;
      expect(rendered).toMatchObject({ ok: false, code: 'render_unavailable' });
    } finally {
      await app.close();
    }
  });

  it('rejects a stale request id with 409 after the turn ended', async () => {
    const channel = createRenderPreviewChannel({ createId: () => 'render-1' });
    const runtime = fakeRuntime(async () => ({ text: '', toolCallCount: 0 }));
    const app = buildServer({ runtime, dbPath: ':memory:', renderChannel: channel });

    try {
      await app.inject({
        method: 'POST',
        url: '/paint/ai/chat',
        payload: chatPayload(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/paint/ai/render-result',
        payload: { requestId: 'render-1', imageUrl: PNG },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        error: { code: 'render_request_unknown' },
      });
    } finally {
      await app.close();
    }
  });

  it('rejects an unknown request id and a malformed body', async () => {
    const runtime = fakeRuntime(async () => ({ text: '', toolCallCount: 0 }));
    const app = buildServer({ runtime, dbPath: ':memory:' });

    try {
      const unknown = await app.inject({
        method: 'POST',
        url: '/paint/ai/render-result',
        payload: { requestId: 'never-requested', imageUrl: PNG },
      });
      expect(unknown.statusCode).toBe(409);

      const missingImage = await app.inject({
        method: 'POST',
        url: '/paint/ai/render-result',
        payload: { requestId: 'render-1' },
      });
      expect(missingImage.statusCode).toBe(400);
      expect(missingImage.json()).toMatchObject({
        error: { code: 'invalid_render_result' },
      });
    } finally {
      await app.close();
    }
  });

  it('drops the pending render when the browser disconnects', async () => {
    const channel = createRenderPreviewChannel({
      createId: () => 'render-1',
      timeoutMs: 60_000,
    });
    let rendered: RenderPreviewResult | undefined;
    const runtime = fakeRuntime(async (input) => {
      // The real runtime binds the turn signal; the fake stands in for it.
      rendered = await input.requestRender!('canvas-1', input.signal);
      return { text: '', toolCallCount: 1 };
    });
    const app = buildServer({ runtime, dbPath: ':memory:', renderChannel: channel });

    try {
      await app.listen({ port: 0, host: '127.0.0.1' });
      const { port } = app.server.address() as AddressInfo;
      const controller = new AbortController();
      const response = await fetch(`http://127.0.0.1:${port}/paint/ai/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(chatPayload()),
        signal: controller.signal,
      });
      const reader = response.body!.getReader();

      // The render request frame is written before the tool waits for a result.
      await reader.read();
      controller.abort();
      await reader.cancel().catch(() => undefined);

      await waitFor(() => rendered ?? null);
      expect(rendered).toMatchObject({ ok: false, code: 'render_unavailable' });

      const late = await app.inject({
        method: 'POST',
        url: '/paint/ai/render-result',
        payload: { requestId: 'render-1', imageUrl: PNG },
      });

      expect(late.statusCode).toBe(409);
    } finally {
      await app.close();
    }
  });
});

import { describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { buildServer } from '../src/api/server.js';
import {
  createExportChannel,
  type ExportResult,
} from '../src/paint/agent/runtime/export-png.js';
import { fakeRuntime } from './helpers/fake-runtime.js';

const REPORT = { filename: '测试画布-canvas-1.png', bytes: 4321 };

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

  throw new Error('timed out waiting for the export request');
}

function chatPayload(message = '把这张图导出来') {
  return { message, canvasId: 'canvas-1' };
}

describe('canvas export request channel', () => {
  it('streams an exportRequest frame and resolves the tool with filename and size', async () => {
    const channel = createExportChannel({ createId: () => 'export-1' });
    let exported: ExportResult | undefined;
    const runtime = fakeRuntime(async (input) => {
      exported = await input.requestExport!('canvas-1');
      return { text: '', toolCallCount: 1 };
    });
    const app = buildServer({ runtime, dbPath: ':memory:', exportChannel: channel });

    try {
      const chat = app.inject({
        method: 'POST',
        url: '/paint/ai/chat',
        payload: chatPayload(),
      });
      const delivery = await waitFor(() => {
        const status = channel.deliver('export-1', REPORT);
        return status.status === 'unknown' ? null : status;
      });

      expect(delivery).toEqual({ status: 'accepted' });

      const response = await chat;

      expect(response.statusCode).toBe(200);
      expect(frames(response.payload)).toEqual([
        { exportRequest: { id: 'export-1', canvasId: 'canvas-1' } },
        { done: true },
      ]);
      // The tool result is the file pointer, not the image.
      expect(exported).toEqual({ ok: true, ...REPORT });
      expect(exported).not.toHaveProperty('imageUrl');
    } finally {
      await app.close();
    }
  });

  it('gives the tool export_unavailable when the browser misses the deadline', async () => {
    const channel = createExportChannel({
      createId: () => 'export-1',
      timeoutMs: 20,
    });
    let exported: ExportResult | undefined;
    const runtime = fakeRuntime(async (input) => {
      exported = await input.requestExport!('canvas-1');
      return { text: '', toolCallCount: 1 };
    });
    const app = buildServer({ runtime, dbPath: ':memory:', exportChannel: channel });

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/paint/ai/chat',
        payload: chatPayload(),
      });

      expect(frames(response.payload)).toEqual([
        { exportRequest: { id: 'export-1', canvasId: 'canvas-1' } },
        { done: true },
      ]);
      expect(exported).toMatchObject({ ok: false, code: 'export_unavailable' });
    } finally {
      await app.close();
    }
  });

  it('turns a browser-side export failure into export_unavailable', async () => {
    const channel = createExportChannel({ createId: () => 'export-1' });
    let exported: ExportResult | undefined;
    const runtime = fakeRuntime(async (input) => {
      exported = await input.requestExport!('canvas-1');
      return { text: '', toolCallCount: 1 };
    });
    const app = buildServer({ runtime, dbPath: ':memory:', exportChannel: channel });

    try {
      const chat = app.inject({
        method: 'POST',
        url: '/paint/ai/chat',
        payload: chatPayload(),
      });
      const delivery = await waitFor(() => {
        const status = channel.deliver('export-1', {
          error: '画布尚未准备好导出',
        });
        return status.status === 'unknown' ? null : status;
      });

      expect(delivery).toEqual({ status: 'accepted' });
      await chat;
      expect(exported).toMatchObject({ ok: false, code: 'export_unavailable' });
    } finally {
      await app.close();
    }
  });

  it('rejects a stale request id and a malformed body', async () => {
    const runtime = fakeRuntime(async () => ({ text: '', toolCallCount: 0 }));
    const app = buildServer({ runtime, dbPath: ':memory:' });

    try {
      const unknown = await app.inject({
        method: 'POST',
        url: '/paint/ai/export-result',
        payload: { requestId: 'never-requested', ...REPORT },
      });
      expect(unknown.statusCode).toBe(409);
      expect(unknown.json()).toMatchObject({
        error: { code: 'export_request_unknown' },
      });

      for (const payload of [
        {},
        { requestId: 'export-1' },
        { requestId: 42, ...REPORT },
        { requestId: 'export-1', filename: 'x.png' },
      ]) {
        const malformed = await app.inject({
          method: 'POST',
          url: '/paint/ai/export-result',
          payload,
        });

        expect(malformed.statusCode).toBe(400);
        expect(malformed.json()).toMatchObject({
          error: { code: 'invalid_export_result' },
        });
      }
    } finally {
      await app.close();
    }
  });

  it('drops the pending export when the browser disconnects', async () => {
    const channel = createExportChannel({
      createId: () => 'export-1',
      timeoutMs: 60_000,
    });
    let exported: ExportResult | undefined;
    const runtime = fakeRuntime(async (input) => {
      // The real runtime binds the turn signal; the fake stands in for it.
      exported = await input.requestExport!('canvas-1', input.signal);
      return { text: '', toolCallCount: 1 };
    });
    const app = buildServer({ runtime, dbPath: ':memory:', exportChannel: channel });

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

      // The export request frame is written before the tool waits for a result.
      await reader.read();
      controller.abort();
      await reader.cancel().catch(() => undefined);

      await waitFor(() => exported ?? null);
      expect(exported).toMatchObject({ ok: false, code: 'export_unavailable' });

      const late = await app.inject({
        method: 'POST',
        url: '/paint/ai/export-result',
        payload: { requestId: 'export-1', ...REPORT },
      });

      expect(late.statusCode).toBe(409);
    } finally {
      await app.close();
    }
  });
});

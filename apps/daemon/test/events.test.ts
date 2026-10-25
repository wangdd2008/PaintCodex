import { request as httpRequest } from 'node:http';
import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/api/server.js';

interface SseClient {
  ready: Promise<void>;
  text: () => string;
  waitFor: (predicate: (text: string) => boolean) => Promise<string>;
  close: () => void;
}

function connectSse(url: string): SseClient {
  let buffer = '';
  let resolveReady: (() => void) | null = null;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  const waiters: Array<{
    predicate: (text: string) => boolean;
    resolve: (text: string) => void;
  }> = [];

  const request = httpRequest(url, (response) => {
    response.setEncoding('utf8');
    response.on('data', (chunk: string) => {
      buffer += chunk;

      if (buffer.includes(': connected')) {
        resolveReady?.();
        resolveReady = null;
      }

      for (const waiter of [...waiters]) {
        if (waiter.predicate(buffer)) {
          waiters.splice(waiters.indexOf(waiter), 1);
          waiter.resolve(buffer);
        }
      }
    });
  });

  request.on('error', () => undefined);
  request.end();

  return {
    ready,
    text: () => buffer,
    waitFor: (predicate) =>
      new Promise((resolve, reject) => {
        if (predicate(buffer)) {
          resolve(buffer);
          return;
        }

        const waiter = {
          predicate,
          resolve: (text: string) => {
            clearTimeout(timer);
            resolve(text);
          },
        };

        const timer = setTimeout(() => {
          const index = waiters.indexOf(waiter);

          if (index >= 0) {
            waiters.splice(index, 1);
          }

          reject(new Error(`SSE timeout. Received: ${buffer}`));
        }, 4000);

        waiters.push(waiter);
      }),
    close: () => request.destroy(),
  };
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  return (await response.json()) as T;
}

describe('canvas event stream', () => {
  it('pushes snapshot_changed after a layer mutation', async () => {
    const app = buildServer({ dbPath: ':memory:' });
    const baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });
    const canvas = await postJson<{ id: string }>(`${baseUrl}/paint/canvas`, {});
    const sse = connectSse(`${baseUrl}/paint/canvas/${canvas.id}/events`);

    await sse.ready;
    await postJson(`${baseUrl}/paint/canvas/${canvas.id}/layers`, {
      name: 'Live stroke',
      type: 'vector',
      content: { kind: 'fabric', json: '{"type":"path","path":[]}' },
      expectedRevision: 0,
    });

    const text = await sse.waitFor((value) => value.includes('event: snapshot_changed'));

    expect(text).toContain('"canvasId":"' + canvas.id + '"');
    expect(text).toContain('"revision":1');

    sse.close();
    await app.close();
  });

  it('returns a structured 404 for an unknown canvas', async () => {
    const app = buildServer({ dbPath: ':memory:' });

    const response = await app.inject({
      method: 'GET',
      url: '/paint/canvas/missing/events',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: 'canvas_not_found', message: '画布不存在' },
    });

    await app.close();
  });
});

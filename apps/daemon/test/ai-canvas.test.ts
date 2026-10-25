import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/api/server.js';
import type { CodexRunner } from '../src/paint/agent/codex-runner.js';
import { CANVAS_ACTION_MARKER } from '../src/paint/agent/canvas-action.js';

const RED_CIRCLE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080"><circle cx="960" cy="540" r="120" fill="red"/></svg>';

function actionText(name: string, svg: string): string {
  return `Drawing that now.\n${CANVAS_ACTION_MARKER}\n${JSON.stringify({ name, svg })}`;
}

function runnerReturning(
  text: string,
  capture?: (prompt: string) => void,
): CodexRunner {
  return {
    run: async (prompt, onDelta) => {
      capture?.(prompt);
      onDelta(text);
      return text;
    },
  };
}

async function createCanvas(
  app: FastifyInstance,
  payload: Record<string, unknown> = {},
): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/paint/canvas',
    payload,
  });

  return response.json().id as string;
}

async function chat(
  app: FastifyInstance,
  message: string,
  canvasId?: string,
) {
  return app.inject({
    method: 'POST',
    url: '/paint/ai/chat',
    payload: { message, canvasId },
  });
}

describe('AI canvas actions', () => {
  it('creates an ai-generated SVG layer through the dispatcher', async () => {
    const app = buildServer({
      dbPath: ':memory:',
      runner: runnerReturning(actionText('AI — Red circle', RED_CIRCLE_SVG)),
    });
    const canvasId = await createCanvas(app);

    const response = await chat(app, 'Draw a red circle', canvasId);
    const fetched = await app.inject({ method: 'GET', url: `/paint/canvas/${canvasId}` });
    const body = fetched.json();

    expect(response.statusCode).toBe(200);
    expect(response.payload).toContain('"layerCreated"');
    expect(response.payload).toContain('"done":true');
    expect(body.revision).toBe(1);
    expect(body.layers).toHaveLength(1);
    expect(body.layers[0]).toMatchObject({
      name: 'AI — Red circle',
      type: 'ai-generated',
      content: { kind: 'svg', svg: RED_CIRCLE_SVG },
      metadata: { createdBy: 'agent', prompt: 'Draw a red circle' },
    });

    await app.close();
  });

  it('passes canvas dimensions and existing layers to Codex', async () => {
    let prompt = '';
    const app = buildServer({
      dbPath: ':memory:',
      runner: runnerReturning('Just chatting.', (value) => {
        prompt = value;
      }),
    });
    const canvasId = await createCanvas(app, { width: 800, height: 600 });
    await app.inject({
      method: 'POST',
      url: `/paint/canvas/${canvasId}/layers`,
      payload: {
        name: 'Base',
        type: 'vector',
        content: { kind: 'fabric', json: '{"type":"path","path":[]}' },
      },
    });

    await chat(app, 'What next?', canvasId);

    expect(prompt).toContain('800x600');
    expect(prompt).toContain('Base [vector]');
    expect(prompt).toContain(canvasId);

    await app.close();
  });

  it('rejects an unsafe SVG without creating a layer', async () => {
    const unsafeSvg =
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
    const app = buildServer({
      dbPath: ':memory:',
      runner: runnerReturning(actionText('AI — Unsafe', unsafeSvg)),
    });
    const canvasId = await createCanvas(app);

    const response = await chat(app, 'Draw something', canvasId);
    const fetched = await app.inject({ method: 'GET', url: `/paint/canvas/${canvasId}` });

    expect(response.payload).toContain('"code":"ai_canvas_action_invalid"');
    expect(fetched.json().layers).toEqual([]);

    await app.close();
  });

  it('leaves ordinary conversation untouched', async () => {
    const app = buildServer({
      dbPath: ':memory:',
      runner: runnerReturning('Paris'),
    });
    const canvasId = await createCanvas(app);

    const response = await chat(app, 'Capital of France?', canvasId);
    const fetched = await app.inject({ method: 'GET', url: `/paint/canvas/${canvasId}` });

    expect(response.payload).toContain('"delta":"Paris"');
    expect(response.payload).toContain('"done":true');
    expect(response.payload).not.toContain('layerCreated');
    expect(fetched.json().layers).toEqual([]);

    await app.close();
  });

  it('reports canvas_required when Codex draws without a canvas', async () => {
    const app = buildServer({
      dbPath: ':memory:',
      runner: runnerReturning(actionText('AI — Red circle', RED_CIRCLE_SVG)),
    });

    const response = await chat(app, 'Draw a red circle');

    expect(response.payload).toContain('"code":"canvas_required"');
    expect(response.payload).toContain('"done":true');

    await app.close();
  });
});

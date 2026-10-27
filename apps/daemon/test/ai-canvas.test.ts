import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type {
  CodexRuntime,
  CodexTurnInput,
} from '../src/paint/agent/runtime/codex-runtime.js';
import { buildServer } from '../src/api/server.js';
import { fakeRuntime } from './helpers/fake-runtime.js';

const RED_CIRCLE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080"><circle cx="960" cy="540" r="120" fill="red"/></svg>';

/** Runs a tool through the tool set the route actually handed to the runtime. */
async function createLayer(
  input: CodexTurnInput,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; layer?: { id: string; name: string }; code?: string }> {
  const result = await input.tools.execute('canvas_create_layer', args, {
    canvasId: input.canvasId,
    prompt: input.userMessage ?? input.prompt,
    trace: input.trace,
  });

  if (result.ok) {
    input.onLayerCreated?.(result.layer as { id: string; name: string });
  }

  return result as { ok: boolean; layer?: { id: string; name: string }; code?: string };
}

function runtimeThatCreatesLayer(
  name: string,
  svg: string,
  captured?: { input?: CodexTurnInput },
): CodexRuntime {
  return fakeRuntime(async (input) => {
    await createLayer(input, {
      canvasId: input.canvasId,
      name,
      svg,
    });
    input.onDelta('Drawing that now.');

    return { text: 'Drawing that now.', toolCallCount: 1 };
  }, captured ?? {});
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

describe('AI canvas tools', () => {
  it('creates an ai-generated SVG layer through the dispatcher', async () => {
    const app = buildServer({
      dbPath: ':memory:',
      runtime: runtimeThatCreatesLayer('AI — Red circle', RED_CIRCLE_SVG),
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

  it('passes a minimal canvas summary to Codex', async () => {
    const captured: { input?: CodexTurnInput } = {};
    const app = buildServer({
      dbPath: ':memory:',
      runtime: fakeRuntime(async () => ({ text: 'Just chatting.', toolCallCount: 0 }), captured),
    });
    const canvasId = await createCanvas(app, { width: 800, height: 600 });
    await app.inject({
      method: 'POST',
      url: `/paint/canvas/${canvasId}/layers`,
      payload: {
        name: 'Base',
        type: 'vector',
        content: { kind: 'fabric', json: '{"type":"path"}' },
      },
    });

    await chat(app, 'What next?', canvasId);

    const prompt = captured.input?.prompt ?? '';

    expect(prompt).toContain(canvasId);
    expect(prompt).toContain('800x600');
    expect(prompt).toContain('Canvas revision: 1');
    expect(prompt).toContain('Layer count: 1');
    expect(prompt).toContain('Layer names: Base');
    // The agent pulls ids and geometry through canvas_get_context instead.
    expect(prompt).not.toContain('CANVAS_ACTION');

    await app.close();
  });

  it('hands the runtime the declared canvas tools when a canvas exists', async () => {
    const captured: { input?: CodexTurnInput } = {};
    const app = buildServer({
      dbPath: ':memory:',
      runtime: fakeRuntime(async () => ({ text: '', toolCallCount: 0 }), captured),
    });
    const canvasId = await createCanvas(app);

    await chat(app, 'What can you do?', canvasId);

    expect(captured.input?.canvasId).toBe(canvasId);
    expect(captured.input?.tools.declarations.map((tool) => tool.name)).toEqual([
      'canvas_get_context',
      'canvas_create_layer',
      'canvas_update_layer',
      'canvas_delete_layer',
      'canvas_undo',
    ]);

    await app.close();
  });

  it('keeps a rejected SVG as a tool failure the model can read, not an SSE error', async () => {
    const unsafeSvg =
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
    const app = buildServer({
      dbPath: ':memory:',
      runtime: runtimeThatCreatesLayer('AI — Unsafe', unsafeSvg),
    });
    const canvasId = await createCanvas(app);

    const response = await chat(app, 'Draw something', canvasId);
    const fetched = await app.inject({ method: 'GET', url: `/paint/canvas/${canvasId}` });

    expect(response.payload).toContain('"done":true');
    expect(response.payload).not.toContain('layerCreated');
    expect(response.payload).not.toContain('"error"');
    expect(fetched.json().layers).toEqual([]);

    await app.close();
  });

  it('leaves ordinary conversation untouched', async () => {
    const app = buildServer({
      dbPath: ':memory:',
      runtime: fakeRuntime(async (input) => {
        input.onDelta('Paris');

        return { text: 'Paris', toolCallCount: 0 };
      }),
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
});

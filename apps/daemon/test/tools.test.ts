import { describe, expect, it } from 'vitest';
import type { AgentLog } from '@paintcodex/protocol';
import { CommandDispatcher } from '../src/paint/command-dispatcher.js';
import { RevisionConflictError } from '../src/paint/errors.js';
import { createCanvasToolSet } from '../src/paint/agent/runtime/tools.js';
import { createObservability } from '../src/observability/index.js';
import {
  CanvasRepository,
  LayerRepository,
  SnapshotRepository,
} from '../src/paint/repository.js';
import { PaintService } from '../src/paint/service.js';
import { PaintEvents } from '../src/paint/events.js';
import { openDatabase } from '../src/storage/database.js';

const RED_CIRCLE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080"><circle cx="960" cy="540" r="120" fill="red"/></svg>';

function createHarness() {
  const db = openDatabase(':memory:');
  const observability = createObservability(db);
  const service = new PaintService(
    new CanvasRepository(db),
    new LayerRepository(db),
    new SnapshotRepository(db),
    new PaintEvents(),
    observability.logger,
  );

  return {
    service,
    dispatcher: new CommandDispatcher(service),
    logger: observability.logger,
    logs: (): AgentLog[] =>
      observability.repository.query({ category: 'canvas-tool', limit: 100 }).items,
  };
}

function context(canvasId: string, prompt = '画一个红圆') {
  return { canvasId, prompt };
}

describe('canvas tool declarations', () => {
  it('declares the two slice-1 tools as function specs', () => {
    const harness = createHarness();
    const tools = createCanvasToolSet(harness);
    const names = tools.declarations.map((declaration) => declaration.name);

    expect(names).toEqual(['canvas_get_context', 'canvas_create_layer']);
    expect(tools.declarations).toContainEqual(
      expect.objectContaining({
        type: 'function',
        name: 'canvas_create_layer',
        inputSchema: expect.objectContaining({
          type: 'object',
          required: ['canvasId', 'name', 'svg'],
        }),
      }),
    );
  });
});

describe('canvas_get_context', () => {
  it('returns the canvas summary and layer ids', async () => {
    const harness = createHarness();
    const tools = createCanvasToolSet(harness);
    const canvas = harness.service.createCanvas({ width: 800, height: 600 });
    harness.dispatcher.dispatch(canvas.id, {
      actor: 'user',
      action: {
        type: 'canvas_create_layer',
        layer: {
          name: 'Base',
          type: 'vector',
          content: { kind: 'fabric', json: '{"type":"path"}' },
        },
      },
    });

    const result = await tools.execute(
      'canvas_get_context',
      { canvasId: canvas.id },
      context(canvas.id, ''),
    );

    expect(result).toMatchObject({
      ok: true,
      canvas: {
        id: canvas.id,
        width: 800,
        height: 600,
        revision: 1,
        layerCount: 1,
      },
      layers: [
        {
          id: expect.any(String),
          name: 'Base',
          type: 'vector',
          contentKind: 'fabric',
        },
      ],
    });
  });

  it('returns one layer in detail when layerId is requested', async () => {
    const harness = createHarness();
    const tools = createCanvasToolSet(harness);
    const canvas = harness.service.createCanvas();
    const updated = harness.dispatcher.dispatch(canvas.id, {
      actor: 'user',
      action: {
        type: 'canvas_create_layer',
        layer: {
          name: 'Base',
          type: 'vector',
          content: { kind: 'fabric', json: '{"type":"path"}' },
        },
      },
    });
    const layerId = updated.layers[0]?.id as string;

    const result = await tools.execute(
      'canvas_get_context',
      { canvasId: canvas.id, layerId },
      context(canvas.id, ''),
    );

    expect(result).toMatchObject({
      ok: true,
      layer: { id: layerId, content: { kind: 'fabric' } },
    });
  });

  it('reports a missing canvas and a missing layer as readable failures', async () => {
    const harness = createHarness();
    const tools = createCanvasToolSet(harness);
    const canvas = harness.service.createCanvas();

    await expect(
      tools.execute('canvas_get_context', { canvasId: 'missing' }, context('missing', '')),
    ).resolves.toMatchObject({ ok: false, code: 'canvas_not_found' });

    await expect(
      tools.execute(
        'canvas_get_context',
        { canvasId: canvas.id, layerId: 'missing' },
        context(canvas.id, ''),
      ),
    ).resolves.toMatchObject({ ok: false, code: 'layer_not_found' });
  });
});

describe('canvas_create_layer', () => {
  it('creates an ai-generated layer through the dispatcher as the agent', async () => {
    const harness = createHarness();
    const tools = createCanvasToolSet(harness);
    const canvas = harness.service.createCanvas();

    const result = await tools.execute(
      'canvas_create_layer',
      { canvasId: canvas.id, name: 'AI — 红色圆形', svg: RED_CIRCLE_SVG, opacity: 0.8 },
      context(canvas.id),
    );

    const updated = harness.service.getCanvas(canvas.id)!;

    expect(result).toMatchObject({
      ok: true,
      layer: { id: expect.any(String), name: 'AI — 红色圆形' },
      revision: 1,
    });
    expect(updated.layers[0]).toMatchObject({
      name: 'AI — 红色圆形',
      type: 'ai-generated',
      opacity: 0.8,
      content: { kind: 'svg', svg: RED_CIRCLE_SVG },
      metadata: { createdBy: 'agent', prompt: '画一个红圆' },
    });
  });

  it('rejects an unsafe SVG with an invalid_svg code and creates nothing', async () => {
    const harness = createHarness();
    const tools = createCanvasToolSet(harness);
    const canvas = harness.service.createCanvas();

    const result = await tools.execute(
      'canvas_create_layer',
      {
        canvasId: canvas.id,
        name: 'AI — Unsafe',
        svg: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      },
      context(canvas.id),
    );

    expect(result).toMatchObject({ ok: false, code: 'invalid_svg' });
    expect(harness.service.getCanvas(canvas.id)!.layers).toEqual([]);
  });

  it('rejects malformed arguments without touching the canvas', async () => {
    const harness = createHarness();
    const tools = createCanvasToolSet(harness);
    const canvas = harness.service.createCanvas();

    await expect(
      tools.execute('canvas_create_layer', { canvasId: canvas.id, svg: RED_CIRCLE_SVG }, context(canvas.id)),
    ).resolves.toMatchObject({ ok: false, code: 'invalid_arguments' });

    await expect(
      tools.execute(
        'canvas_create_layer',
        { canvasId: canvas.id, name: 'x', svg: RED_CIRCLE_SVG, opacity: 4 },
        context(canvas.id),
      ),
    ).resolves.toMatchObject({ ok: false, code: 'invalid_arguments' });
  });

  it('maps a revision conflict to a result the model can read', async () => {
    const harness = createHarness();
    const canvas = harness.service.createCanvas();
    const dispatcher = {
      dispatch: () => {
        throw new RevisionConflictError(0, 1);
      },
    } as unknown as CommandDispatcher;
    const tools = createCanvasToolSet({ ...harness, dispatcher });

    const result = await tools.execute(
      'canvas_create_layer',
      { canvasId: canvas.id, name: 'AI', svg: RED_CIRCLE_SVG },
      context(canvas.id),
    );

    expect(result).toMatchObject({
      ok: false,
      code: 'revision_conflict',
      currentRevision: 1,
    });
  });

  it('records one tool_result log with the agent actor and trace linkage', async () => {
    const harness = createHarness();
    const tools = createCanvasToolSet(harness);
    const canvas = harness.service.createCanvas();
    const trace = harness.logger.startTrace({ category: 'ai-chat', message: 'ai_chat' });

    await tools.execute(
      'canvas_create_layer',
      { canvasId: canvas.id, name: 'AI', svg: RED_CIRCLE_SVG },
      { ...context(canvas.id), trace },
    );

    const record = harness.logs().find((log) => log.message === 'tool_result');

    expect(record).toMatchObject({
      category: 'canvas-tool',
      level: 'info',
      actor: 'agent',
      canvasId: canvas.id,
      traceId: trace.traceId,
      parentId: trace.spanId,
      payload: { tool: 'canvas_create_layer', ok: true, layerId: expect.any(String) },
    });
  });
});

describe('unknown canvas tools', () => {
  it('returns unknown_tool', async () => {
    const harness = createHarness();
    const tools = createCanvasToolSet(harness);

    await expect(
      tools.execute('canvas_delete_layer', {}, context('canvas-1')),
    ).resolves.toMatchObject({ ok: false, code: 'unknown_tool' });
  });
});

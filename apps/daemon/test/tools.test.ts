import { describe, expect, it } from 'vitest';
import type { AgentLog } from '@paintcodex/protocol';
import { CommandDispatcher } from '../src/paint/command-dispatcher.js';
import { RevisionConflictError } from '../src/paint/errors.js';
import { createCanvasToolSet } from '../src/paint/agent/runtime/tools.js';
import type {
  ConfirmationOutcome,
  ConfirmationRequest,
} from '../src/paint/agent/runtime/confirmation.js';
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
    db,
    logs: (): AgentLog[] =>
      observability.repository.query({ category: 'canvas-tool', limit: 100 }).items,
  };
}

/** The undo stack is the snapshots table: a UI signal must not add a row to it. */
function snapshotCount(
  db: ReturnType<typeof openDatabase>,
  canvasId: string,
): number {
  const row = db
    .prepare<[string], { count: number }>(
      'SELECT COUNT(*) AS count FROM snapshots WHERE canvasId = ?',
    )
    .get(canvasId);

  return row?.count ?? 0;
}

function context(
  canvasId: string,
  prompt = '画一个红圆',
  requestConfirmation?: (request: ConfirmationRequest) => Promise<ConfirmationOutcome>,
) {
  return {
    canvasId,
    prompt,
    ...(requestConfirmation === undefined ? {} : { requestConfirmation }),
  };
}

function confirmWith(outcome: ConfirmationOutcome, seen: ConfirmationRequest[] = []) {
  return async (request: ConfirmationRequest): Promise<ConfirmationOutcome> => {
    seen.push(request);
    return outcome;
  };
}

const BLUE_RECT_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080"><rect x="100" y="100" width="300" height="200" fill="blue"/></svg>';

/** A canvas with one user-created layer, so the undo stack starts on `user`. */
function seedLayer(
  harness: ReturnType<typeof createHarness>,
  canvasId: string,
  svg = RED_CIRCLE_SVG,
): string {
  const updated = harness.dispatcher.dispatch(canvasId, {
    actor: 'user',
    action: {
      type: 'canvas_create_layer',
      layer: {
        name: 'Base',
        type: 'vector',
        content: { kind: 'svg', svg },
      },
    },
  });

  return updated.layers[0]?.id as string;
}


describe('canvas tool declarations', () => {
  it('declares the layer tools as function specs', () => {
    const harness = createHarness();
    const tools = createCanvasToolSet(harness);
    const names = tools.declarations.map((declaration) => declaration.name);

    // The documented set is seven tools (ADR-0009): the code must not be one short.
    expect(names).toEqual([
      'canvas_get_context',
      'canvas_create_layer',
      'canvas_update_layer',
      'canvas_delete_layer',
      'canvas_select',
      'canvas_export_png',
      'canvas_undo',
      'canvas_render_preview',
    ]);
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
    expect(tools.declarations).toContainEqual(
      expect.objectContaining({
        type: 'function',
        name: 'canvas_update_layer',
        inputSchema: expect.objectContaining({
          type: 'object',
          required: ['canvasId', 'layerId', 'patch'],
        }),
      }),
    );
  });
});

describe('canvas_select', () => {
  it('rejects a call that names neither a layer nor a region, and one that names both', async () => {
    const harness = createHarness();
    const tools = createCanvasToolSet(harness);
    const canvas = harness.service.createCanvas();
    const layerId = seedLayer(harness, canvas.id);

    await expect(
      tools.execute('canvas_select', { canvasId: canvas.id }, context(canvas.id)),
    ).resolves.toMatchObject({ ok: false, code: 'invalid_arguments' });

    await expect(
      tools.execute(
        'canvas_select',
        {
          canvasId: canvas.id,
          layerId,
          region: { x: 0, y: 0, width: 10, height: 10 },
        },
        context(canvas.id),
      ),
    ).resolves.toMatchObject({ ok: false, code: 'invalid_arguments' });
  });

  it('points the browser at an existing layer without writing anything', async () => {
    const harness = createHarness();
    const tools = createCanvasToolSet(harness);
    const canvas = harness.service.createCanvas();
    const layerId = seedLayer(harness, canvas.id);
    const snapshotsBefore = snapshotCount(harness.db, canvas.id);

    const result = await tools.execute(
      'canvas_select',
      { canvasId: canvas.id, layerId },
      context(canvas.id),
    );

    expect(result).toEqual({
      ok: true,
      selection: { canvasId: canvas.id, layerId },
    });
    // No DB write, no snapshot, no revision bump, no undo entry.
    expect(harness.service.getCanvas(canvas.id)!.revision).toBe(1);
    expect(snapshotCount(harness.db, canvas.id)).toBe(snapshotsBefore);
    expect(harness.service.getUndoTarget(canvas.id)).toMatchObject({
      revision: 1,
      actor: 'user',
      action: 'canvas_create_layer',
    });
  });

  it('reports an unknown layer as layer_not_found without writing anything', async () => {
    const harness = createHarness();
    const tools = createCanvasToolSet(harness);
    const canvas = harness.service.createCanvas();
    seedLayer(harness, canvas.id);
    const snapshotsBefore = snapshotCount(harness.db, canvas.id);

    const result = await tools.execute(
      'canvas_select',
      { canvasId: canvas.id, layerId: 'missing' },
      context(canvas.id),
    );

    expect(result).toMatchObject({ ok: false, code: 'layer_not_found' });
    expect(harness.service.getCanvas(canvas.id)!.revision).toBe(1);
    expect(snapshotCount(harness.db, canvas.id)).toBe(snapshotsBefore);
  });

  it('clamps an out-of-bounds region into the canvas and says so instead of failing', async () => {
    const harness = createHarness();
    const tools = createCanvasToolSet(harness);
    const canvas = harness.service.createCanvas({ width: 800, height: 600 });
    const snapshotsBefore = snapshotCount(harness.db, canvas.id);

    const clamped = await tools.execute(
      'canvas_select',
      {
        canvasId: canvas.id,
        region: { x: -100, y: 500, width: 200, height: 400 },
      },
      context(canvas.id),
    );

    expect(clamped).toMatchObject({
      ok: true,
      selection: {
        canvasId: canvas.id,
        // Intersection of the requested box with 800 × 600.
        region: { x: 0, y: 500, width: 200, height: 100 },
        clamped: true,
      },
      message: expect.stringContaining('裁剪'),
    });

    const inside = await tools.execute(
      'canvas_select',
      {
        canvasId: canvas.id,
        region: { x: 10, y: 20, width: 100, height: 50 },
      },
      context(canvas.id),
    );

    expect(inside).toEqual({
      ok: true,
      selection: {
        canvasId: canvas.id,
        region: { x: 10, y: 20, width: 100, height: 50 },
      },
    });

    // Circling an area is a UI hint too: still no write, no snapshot.
    expect(harness.service.getCanvas(canvas.id)!.revision).toBe(0);
    expect(snapshotCount(harness.db, canvas.id)).toBe(snapshotsBefore);
  });

  it('rejects a region that is not a rectangle of numbers', async () => {
    const harness = createHarness();
    const tools = createCanvasToolSet(harness);
    const canvas = harness.service.createCanvas();

    for (const region of [
      { x: 0, y: 0, width: 10 },
      { x: 0, y: 0, width: 0, height: 10 },
      { x: 'a', y: 0, width: 10, height: 10 },
      [],
    ]) {
      await expect(
        tools.execute(
          'canvas_select',
          { canvasId: canvas.id, region },
          context(canvas.id),
        ),
      ).resolves.toMatchObject({ ok: false, code: 'invalid_arguments' });
    }
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

  it('records one tool_call log with the agent actor, argument summary and duration', async () => {
    const harness = createHarness();
    const tools = createCanvasToolSet(harness);
    const canvas = harness.service.createCanvas();
    const trace = harness.logger.startTrace({ category: 'ai-chat', message: 'ai_chat' });

    await tools.execute(
      'canvas_create_layer',
      { canvasId: canvas.id, name: 'AI', svg: RED_CIRCLE_SVG },
      { ...context(canvas.id), trace },
    );

    const record = harness.logs().find((log) => log.message === 'tool_call');

    expect(record).toMatchObject({
      category: 'canvas-tool',
      level: 'info',
      actor: 'agent',
      canvasId: canvas.id,
      traceId: trace.traceId,
      parentId: trace.spanId,
      payload: {
        tool: 'canvas_create_layer',
        ok: true,
        layerId: expect.any(String),
        argumentSummary: {
          name: 'AI',
          svgLength: RED_CIRCLE_SVG.length,
        },
      },
    });
    expect(typeof record?.durationMs).toBe('number');
  });
});

describe('canvas_update_layer', () => {
  it('rewrites an existing layer through the dispatcher and bumps the revision', async () => {
    const harness = createHarness();
    const tools = createCanvasToolSet(harness);
    const canvas = harness.service.createCanvas();
    const layerId = seedLayer(harness, canvas.id);

    const result = await tools.execute(
      'canvas_update_layer',
      {
        canvasId: canvas.id,
        layerId,
        patch: { name: 'AI — 蓝方块', svg: BLUE_RECT_SVG, opacity: 0.5 },
      },
      context(canvas.id),
    );

    const updated = harness.service.getCanvas(canvas.id)!;

    expect(result).toMatchObject({
      ok: true,
      layer: { id: layerId, name: 'AI — 蓝方块' },
      revision: 2,
    });
    expect(updated.layers[0]).toMatchObject({
      id: layerId,
      name: 'AI — 蓝方块',
      opacity: 0.5,
      content: { kind: 'svg', svg: BLUE_RECT_SVG },
    });
  });

  it('rejects an unsafe SVG with invalid_svg and leaves the layer untouched', async () => {
    const harness = createHarness();
    const tools = createCanvasToolSet(harness);
    const canvas = harness.service.createCanvas();
    const layerId = seedLayer(harness, canvas.id);

    const result = await tools.execute(
      'canvas_update_layer',
      {
        canvasId: canvas.id,
        layerId,
        patch: {
          svg: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
        },
      },
      context(canvas.id),
    );

    const unchanged = harness.service.getCanvas(canvas.id)!;

    expect(result).toMatchObject({ ok: false, code: 'invalid_svg' });
    expect(unchanged.revision).toBe(1);
    expect(unchanged.layers[0]?.content).toEqual({ kind: 'svg', svg: RED_CIRCLE_SVG });
  });

  it('reports an unknown layer as layer_not_found without changing the canvas', async () => {
    const harness = createHarness();
    const tools = createCanvasToolSet(harness);
    const canvas = harness.service.createCanvas();

    const result = await tools.execute(
      'canvas_update_layer',
      { canvasId: canvas.id, layerId: 'missing', patch: { name: 'x' } },
      context(canvas.id),
    );

    expect(result).toMatchObject({ ok: false, code: 'layer_not_found' });
    expect(harness.service.getCanvas(canvas.id)!.revision).toBe(0);
  });

  it('returns a revision conflict with the current revision instead of retrying', async () => {
    const harness = createHarness();
    const canvas = harness.service.createCanvas();
    const dispatcher = {
      dispatch: () => {
        throw new RevisionConflictError(0, 4);
      },
    } as unknown as CommandDispatcher;
    const tools = createCanvasToolSet({ ...harness, dispatcher });

    const result = await tools.execute(
      'canvas_update_layer',
      { canvasId: canvas.id, layerId: 'layer-1', patch: { name: 'x' } },
      context(canvas.id),
    );

    expect(result).toMatchObject({
      ok: false,
      code: 'revision_conflict',
      currentRevision: 4,
    });
  });

  it('rejects an empty or malformed patch', async () => {
    const harness = createHarness();
    const tools = createCanvasToolSet(harness);
    const canvas = harness.service.createCanvas();
    const layerId = seedLayer(harness, canvas.id);

    await expect(
      tools.execute(
        'canvas_update_layer',
        { canvasId: canvas.id, layerId, patch: {} },
        context(canvas.id),
      ),
    ).resolves.toMatchObject({ ok: false, code: 'invalid_arguments' });

    await expect(
      tools.execute(
        'canvas_update_layer',
        { canvasId: canvas.id, layerId, patch: { visible: 'yes' } },
        context(canvas.id),
      ),
    ).resolves.toMatchObject({ ok: false, code: 'invalid_arguments' });
  });
});

describe('canvas_delete_layer', () => {
  it('asks for the layer by name and deletes only after approval', async () => {
    const harness = createHarness();
    const tools = createCanvasToolSet(harness);
    const canvas = harness.service.createCanvas();
    const layerId = seedLayer(harness, canvas.id);
    const asked: ConfirmationRequest[] = [];

    const result = await tools.execute(
      'canvas_delete_layer',
      { canvasId: canvas.id, layerId },
      context(canvas.id, '删掉它', confirmWith('approved', asked)),
    );

    const updated = harness.service.getCanvas(canvas.id)!;

    expect(asked).toEqual([
      {
        title: '删除图层「Base」',
        detail: '这是不可逆操作：确认后该图层会从画布上移除。',
      },
    ]);
    expect(result).toMatchObject({ ok: true, layerId, revision: 2 });
    expect(updated.layers).toEqual([]);
  });

  it('refuses without touching the canvas when the user declines', async () => {
    const harness = createHarness();
    const tools = createCanvasToolSet(harness);
    const canvas = harness.service.createCanvas();
    const layerId = seedLayer(harness, canvas.id);

    const result = await tools.execute(
      'canvas_delete_layer',
      { canvasId: canvas.id, layerId },
      context(canvas.id, '删掉它', confirmWith('declined')),
    );

    const unchanged = harness.service.getCanvas(canvas.id)!;

    expect(result).toMatchObject({ ok: false, code: 'user_declined' });
    expect(unchanged.layers).toHaveLength(1);
    expect(unchanged.revision).toBe(1);
  });

  it('tells the model the user did not answer when confirmation times out', async () => {
    const harness = createHarness();
    const tools = createCanvasToolSet(harness);
    const canvas = harness.service.createCanvas();
    const layerId = seedLayer(harness, canvas.id);

    const result = await tools.execute(
      'canvas_delete_layer',
      { canvasId: canvas.id, layerId },
      context(canvas.id, '删掉它', confirmWith('timeout')),
    );

    expect(result).toMatchObject({
      ok: false,
      code: 'user_declined',
      message: expect.stringContaining('未答复'),
    });
    expect(harness.service.getCanvas(canvas.id)!.layers).toHaveLength(1);
  });

  it('treats a disconnect or interrupt as a refusal', async () => {
    const harness = createHarness();
    const tools = createCanvasToolSet(harness);
    const canvas = harness.service.createCanvas();
    const layerId = seedLayer(harness, canvas.id);

    await expect(
      tools.execute(
        'canvas_delete_layer',
        { canvasId: canvas.id, layerId },
        context(canvas.id, '删掉它', confirmWith('disconnected')),
      ),
    ).resolves.toMatchObject({ ok: false, code: 'user_declined' });

    await expect(
      tools.execute(
        'canvas_delete_layer',
        { canvasId: canvas.id, layerId },
        context(canvas.id, '删掉它', confirmWith('interrupted')),
      ),
    ).resolves.toMatchObject({ ok: false, code: 'user_declined' });
    expect(harness.service.getCanvas(canvas.id)!.layers).toHaveLength(1);
  });

  it('fails closed when no confirmation channel is available', async () => {
    const harness = createHarness();
    const tools = createCanvasToolSet(harness);
    const canvas = harness.service.createCanvas();
    const layerId = seedLayer(harness, canvas.id);

    const result = await tools.execute(
      'canvas_delete_layer',
      { canvasId: canvas.id, layerId },
      context(canvas.id),
    );

    expect(result).toMatchObject({ ok: false, code: 'user_declined' });
    expect(harness.service.getCanvas(canvas.id)!.layers).toHaveLength(1);
  });

  it('reports an unknown layer as layer_not_found without asking the user', async () => {
    const harness = createHarness();
    const tools = createCanvasToolSet(harness);
    const canvas = harness.service.createCanvas();
    seedLayer(harness, canvas.id);
    const asked: ConfirmationRequest[] = [];

    const result = await tools.execute(
      'canvas_delete_layer',
      { canvasId: canvas.id, layerId: 'missing' },
      context(canvas.id, '删掉它', confirmWith('approved', asked)),
    );

    expect(result).toMatchObject({ ok: false, code: 'layer_not_found' });
    expect(asked).toEqual([]);
    expect(harness.service.getCanvas(canvas.id)!.revision).toBe(1);
  });

  it('still reports a revision conflict that happens after approval', async () => {
    const harness = createHarness();
    const canvas = harness.service.createCanvas();
    const layerId = seedLayer(harness, canvas.id);
    const dispatcher = {
      dispatch: () => {
        throw new RevisionConflictError(0, 4);
      },
    } as unknown as CommandDispatcher;
    const tools = createCanvasToolSet({ ...harness, dispatcher });

    const result = await tools.execute(
      'canvas_delete_layer',
      { canvasId: canvas.id, layerId },
      context(canvas.id, '删掉它', confirmWith('approved')),
    );

    expect(result).toMatchObject({ ok: false, code: 'revision_conflict' });
  });
});

describe('canvas_undo scoping', () => {
  it('undoes the agent step when the agent owns the top snapshot', async () => {
    const harness = createHarness();
    const tools = createCanvasToolSet(harness);
    const canvas = harness.service.createCanvas();
    const layerId = seedLayer(harness, canvas.id);

    await tools.execute(
      'canvas_update_layer',
      { canvasId: canvas.id, layerId, patch: { svg: BLUE_RECT_SVG } },
      context(canvas.id),
    );

    const result = await tools.execute(
      'canvas_undo',
      { canvasId: canvas.id },
      context(canvas.id),
    );

    const restored = harness.service.getCanvas(canvas.id)!;

    expect(result).toMatchObject({
      ok: true,
      revision: 3,
      undoneAction: 'canvas_update_layer',
    });
    expect(restored.layers[0]?.content).toEqual({ kind: 'svg', svg: RED_CIRCLE_SVG });
    expect(restored.history.canUndo).toBe(true);
  });

  it('refuses to undo a user step and leaves the canvas untouched', async () => {
    const harness = createHarness();
    const tools = createCanvasToolSet(harness);
    const canvas = harness.service.createCanvas();
    seedLayer(harness, canvas.id);

    const result = await tools.execute(
      'canvas_undo',
      { canvasId: canvas.id },
      context(canvas.id),
    );

    expect(result).toMatchObject({ ok: false, code: 'top_action_is_user' });
    expect(harness.service.getCanvas(canvas.id)!.revision).toBe(1);
    expect(harness.service.getCanvas(canvas.id)!.layers).toHaveLength(1);
  });

  it('reports nothing_to_undo on an exhausted stack instead of blaming the user', async () => {
    const harness = createHarness();
    const tools = createCanvasToolSet(harness);
    const canvas = harness.service.createCanvas();

    // One agent action: the canvas-create snapshot is the only thing beneath it.
    await tools.execute(
      'canvas_create_layer',
      { canvasId: canvas.id, name: 'AI', svg: RED_CIRCLE_SVG },
      context(canvas.id),
    );

    const first = await tools.execute(
      'canvas_undo',
      { canvasId: canvas.id },
      context(canvas.id),
    );

    expect(first).toMatchObject({ ok: true, revision: 2 });

    const second = await tools.execute(
      'canvas_undo',
      { canvasId: canvas.id },
      context(canvas.id),
    );

    // The honest answer is "nothing left", not top_action_is_user: the user
    // cannot undo anything either.
    expect(second).toEqual({
      ok: false,
      code: 'nothing_to_undo',
      message: '没有可撤销的操作',
    });
  });

  it('reports a revision conflict from the dispatcher as a readable failure', async () => {
    const harness = createHarness();
    const canvas = harness.service.createCanvas();
    const service = {
      getCanvas: (id: string) => harness.service.getCanvas(id),
      getUndoTarget: () => ({
        kind: 'target' as const,
        revision: 1,
        actor: 'agent' as const,
        action: 'canvas_create_layer',
      }),
    };
    const dispatcher = {
      dispatch: () => {
        throw new Error('unused');
      },
      undo: () => {
        throw new RevisionConflictError(0, 5);
      },
    } as unknown as CommandDispatcher;
    const tools = createCanvasToolSet({ dispatcher, service, logger: harness.logger });

    const result = await tools.execute(
      'canvas_undo',
      { canvasId: canvas.id },
      context(canvas.id),
    );

    expect(result).toMatchObject({
      ok: false,
      code: 'revision_conflict',
      currentRevision: 5,
    });
  });
});

describe('unknown canvas tools', () => {
  it('returns unknown_tool', async () => {
    const harness = createHarness();
    const tools = createCanvasToolSet(harness);

    await expect(
      tools.execute('canvas_zoom', {}, context('canvas-1')),
    ).resolves.toMatchObject({ ok: false, code: 'unknown_tool' });
  });
});

describe('canvas_export_png', () => {
  it('declares an export tool that warns the user before downloading', () => {
    const harness = createHarness();
    const declaration = createCanvasToolSet(harness).declarations.find(
      (candidate) => candidate.name === 'canvas_export_png',
    );

    expect(declaration).toMatchObject({
      type: 'function',
      inputSchema: expect.objectContaining({
        type: 'object',
        required: ['canvasId'],
      }),
    });
    expect(declaration?.description.toLowerCase()).toContain('png');
  });

  it('asks to download a PNG and returns only the filename and size', async () => {
    const harness = createHarness();
    const tools = createCanvasToolSet(harness);
    const canvas = harness.service.createCanvas({ name: '海报' });
    const seen: ConfirmationRequest[] = [];
    const exported: string[] = [];

    const result = await tools.execute('canvas_export_png', {}, {
      ...context(canvas.id, '把这张图导出来', confirmWith('approved', seen)),
      requestExport: async (canvasId) => {
        exported.push(canvasId);
        return { ok: true, filename: '海报-canvas-1.png', bytes: 4321 };
      },
    });

    expect(exported).toEqual([canvas.id]);
    // The model gets a pointer to the download, never the image itself.
    expect(result).toEqual({
      ok: true,
      filename: '海报-canvas-1.png',
      bytes: 4321,
    });
    expect(result).not.toHaveProperty('imageUrl');

    expect(seen).toHaveLength(1);
    expect(seen[0]?.title).toContain('海报');
    expect(seen[0]?.detail).toContain('下载');
    expect(seen[0]?.detail).toContain('PNG');
    // The delete copy explains an irreversible removal; export must not.
    expect(seen[0]?.detail).not.toContain('移除');
    expect(seen[0]?.approveLabel).toBe('下载 PNG');
  });

  it('does not export when the user declines or never answers', async () => {
    const harness = createHarness();
    const tools = createCanvasToolSet(harness);
    const canvas = harness.service.createCanvas();
    let called = false;
    const requestExport = async () => {
      called = true;
      return { ok: true as const, filename: 'a.png', bytes: 1 };
    };

    for (const outcome of [
      'declined',
      'timeout',
      'disconnected',
      'interrupted',
    ] as const) {
      await expect(
        tools.execute('canvas_export_png', {}, {
          ...context(canvas.id, '导出', confirmWith(outcome)),
          requestExport,
        }),
      ).resolves.toMatchObject({ ok: false, code: 'user_declined' });
    }

    expect(called).toBe(false);
  });

  it('fails closed when no confirmation channel is available', async () => {
    const harness = createHarness();
    const tools = createCanvasToolSet(harness);
    const canvas = harness.service.createCanvas();
    let called = false;

    const result = await tools.execute('canvas_export_png', {}, {
      ...context(canvas.id),
      requestExport: async () => {
        called = true;
        return { ok: true as const, filename: 'a.png', bytes: 1 };
      },
    });

    expect(result).toMatchObject({ ok: false, code: 'user_declined' });
    expect(called).toBe(false);
  });

  it('reports export_unavailable when no browser is connected', async () => {
    const harness = createHarness();
    const tools = createCanvasToolSet(harness);
    const canvas = harness.service.createCanvas();

    await expect(
      tools.execute('canvas_export_png', {}, {
        ...context(canvas.id, '导出', confirmWith('approved')),
      }),
    ).resolves.toMatchObject({ ok: false, code: 'export_unavailable' });
  });

  it('passes a busy or unavailable export back to the model', async () => {
    const harness = createHarness();
    const tools = createCanvasToolSet(harness);
    const canvas = harness.service.createCanvas();

    for (const code of ['export_busy', 'export_unavailable'] as const) {
      await expect(
        tools.execute('canvas_export_png', {}, {
          ...context(canvas.id, '导出', confirmWith('approved')),
          requestExport: async () => ({
            ok: false as const,
            code,
            message: '稍后再试',
          }),
        }),
      ).resolves.toMatchObject({ ok: false, code });
    }
  });
});

describe('canvas_render_preview', () => {
  const PNG = 'data:image/png;base64,AAAA';

  it('declares the preview tool without telling the model to call it constantly', () => {
    const harness = createHarness();
    const declaration = createCanvasToolSet(harness).declarations.find(
      (candidate) => candidate.name === 'canvas_render_preview',
    );

    expect(declaration).toMatchObject({
      type: 'function',
      inputSchema: expect.objectContaining({
        type: 'object',
        required: ['canvasId'],
      }),
    });
    expect(declaration?.description.toLowerCase()).not.toContain('always');
  });

  it('returns the rendered PNG for the canvas the turn belongs to', async () => {
    const harness = createHarness();
    const tools = createCanvasToolSet(harness);
    const canvas = harness.service.createCanvas();
    const rendered: string[] = [];

    const result = await tools.execute(
      'canvas_render_preview',
      { canvasId: canvas.id },
      {
        ...context(canvas.id),
        requestRender: async (canvasId) => {
          rendered.push(canvasId);
          return { ok: true, imageUrl: PNG };
        },
      },
    );

    expect(rendered).toEqual([canvas.id]);
    expect(result).toEqual({ ok: true, imageUrl: PNG });
  });

  it('degrades to render_unavailable when the browser cannot render', async () => {
    const harness = createHarness();
    const tools = createCanvasToolSet(harness);
    const canvas = harness.service.createCanvas();

    await expect(
      tools.execute('canvas_render_preview', {}, context(canvas.id)),
    ).resolves.toMatchObject({ ok: false, code: 'render_unavailable' });

    await expect(
      tools.execute('canvas_render_preview', {}, {
        ...context(canvas.id),
        requestRender: async () => ({
          ok: false,
          code: 'render_unavailable',
          message: '超时',
        }),
      }),
    ).resolves.toMatchObject({ ok: false, code: 'render_unavailable' });
  });

  it('refuses a canvas other than the active one', async () => {
    const harness = createHarness();
    const tools = createCanvasToolSet(harness);
    let called = false;

    await expect(
      tools.execute(
        'canvas_render_preview',
        { canvasId: 'another-canvas' },
        {
          ...context('canvas-1'),
          requestRender: async () => {
            called = true;
            return { ok: true, imageUrl: PNG };
          },
        },
      ),
    ).resolves.toMatchObject({ ok: false, code: 'canvas_not_found' });
    expect(called).toBe(false);
  });
});

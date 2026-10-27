import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AgentLog, CreateLayerInput } from '@paintcodex/protocol';
import { buildServer } from '../src/api/server.js';
import { createObservability } from '../src/observability/index.js';
import type { AgentLogRepository } from '../src/observability/repository.js';
import { CommandDispatcher } from '../src/paint/command-dispatcher.js';
import { createCanvasToolSet } from '../src/paint/agent/runtime/tools.js';
import { PaintEvents } from '../src/paint/events.js';
import {
  CanvasRepository,
  LayerRepository,
  SnapshotRepository,
} from '../src/paint/repository.js';
import { PaintService } from '../src/paint/service.js';
import { openDatabase } from '../src/storage/database.js';

const LAYER: CreateLayerInput = {
  name: 'Agent stroke',
  type: 'vector',
  content: { kind: 'fabric', json: '{"type":"path","path":[]}' },
};

function canvasActionLog(
  repository: AgentLogRepository,
  message: string,
): AgentLog | undefined {
  return repository
    .query({ category: 'canvas-action', limit: 200 })
    .items.find((log) => log.message === message);
}

/**
 * The service seam with real repositories, so the snapshot row a caller's
 * action produces is observable without going through HTTP.
 */
function buildServiceSeam() {
  const db = openDatabase(':memory:');
  const observability = createObservability(db);
  const snapshots = new SnapshotRepository(db);
  const service = new PaintService(
    new CanvasRepository(db),
    new LayerRepository(db),
    snapshots,
    new PaintEvents(),
    observability.logger,
  );
  const dispatcher = new CommandDispatcher(service);

  return {
    dispatcher,
    service,
    snapshots,
    logs: observability.repository,
    close: () => db.close(),
  };
}

function createAgentLayer(
  dispatcher: CommandDispatcher,
  canvasId: string,
  expectedRevision: number,
): number {
  return dispatcher.dispatch(canvasId, {
    actor: 'agent',
    expectedRevision,
    action: { type: 'canvas_create_layer', layer: LAYER },
  }).revision;
}

describe('actor attribution for programmatic callers', () => {
  it('records the caller actor on the canvas creation snapshot and log', () => {
    const seam = buildServiceSeam();

    try {
      const canvas = seam.dispatcher.createCanvas({ name: 'Agent canvas' }, 'agent');

      expect(seam.snapshots.latest(canvas.id)).toMatchObject({
        actor: 'agent',
        action: 'canvas_create',
      });
      expect(canvasActionLog(seam.logs, 'canvas_create')).toMatchObject({
        canvasId: canvas.id,
        revision: 0,
        actor: 'agent',
      });
    } finally {
      seam.close();
    }
  });

  it('records the caller actor on rename, undo and redo logs', () => {
    const seam = buildServiceSeam();

    try {
      const canvas = seam.dispatcher.createCanvas({ name: 'Agent history' });
      createAgentLayer(seam.dispatcher, canvas.id, 0);

      seam.dispatcher.renameCanvas(canvas.id, 'Agent renamed', 'agent');
      expect(canvasActionLog(seam.logs, 'canvas_rename')).toMatchObject({
        canvasId: canvas.id,
        actor: 'agent',
        payload: { name: 'Agent renamed' },
      });

      const undone = seam.dispatcher.undo(canvas.id, 1, 'agent');
      expect(canvasActionLog(seam.logs, 'undo')).toMatchObject({
        canvasId: canvas.id,
        revision: undone.revision,
        actor: 'agent',
      });

      const redone = seam.dispatcher.redo(canvas.id, undone.revision, 'agent');
      expect(canvasActionLog(seam.logs, 'redo')).toMatchObject({
        canvasId: canvas.id,
        revision: redone.revision,
        actor: 'agent',
      });
    } finally {
      seam.close();
    }
  });

  it('keeps user as the default actor when a caller omits it', () => {
    const seam = buildServiceSeam();

    try {
      const canvas = seam.dispatcher.createCanvas({ name: 'Default actor' });

      expect(seam.snapshots.latest(canvas.id)).toMatchObject({ actor: 'user' });
      expect(canvasActionLog(seam.logs, 'canvas_create')).toMatchObject({
        actor: 'user',
      });

      seam.dispatcher.dispatch(canvas.id, {
        actor: 'user',
        expectedRevision: 0,
        action: { type: 'canvas_create_layer', layer: LAYER },
      });
      seam.dispatcher.undo(canvas.id, 1);
      expect(canvasActionLog(seam.logs, 'undo')).toMatchObject({ actor: 'user' });
    } finally {
      seam.close();
    }
  });
});

describe('actor attribution for REST callers', () => {
  it('records user for canvas creation, rename, layer changes, undo and redo', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'paintcodex-actor-'));
    const dbPath = join(directory, 'daemon.db');
    const app = buildServer({ dbPath });
    let canvasId = '';

    try {
      const created = await app.inject({
        method: 'POST',
        url: '/paint/canvas',
        payload: { name: 'REST canvas' },
      });
      canvasId = created.json().id as string;

      const layer = await app.inject({
        method: 'POST',
        url: `/paint/canvas/${canvasId}/layers`,
        payload: { ...LAYER, expectedRevision: 0 },
      });
      const layerId = layer.json().layers[0].id as string;

      const renamed = await app.inject({
        method: 'PATCH',
        url: `/paint/canvas/${canvasId}`,
        payload: { name: 'REST renamed' },
      });
      expect(renamed.statusCode).toBe(200);

      const undone = await app.inject({
        method: 'POST',
        url: `/paint/canvas/${canvasId}/undo`,
        payload: { expectedRevision: 1 },
      });
      expect(undone.statusCode).toBe(200);

      const redone = await app.inject({
        method: 'POST',
        url: `/paint/canvas/${canvasId}/redo`,
        payload: { expectedRevision: undone.json().revision },
      });
      expect(redone.statusCode).toBe(200);

      const deleted = await app.inject({
        method: 'DELETE',
        url: `/paint/canvas/${canvasId}/layers/${layerId}?expectedRevision=${redone.json().revision}`,
      });
      expect(deleted.statusCode).toBe(200);

      for (const message of [
        'canvas_create',
        'canvas_rename',
        'layer_create',
        'undo',
        'redo',
        'layer_delete',
      ]) {
        expect(canvasActionLog(app.observability.repository, message)).toMatchObject({
          canvasId,
          actor: 'user',
        });
      }
    } finally {
      await app.close();
    }

    try {
      const db = openDatabase(dbPath);

      try {
        expect(new SnapshotRepository(db).latest(canvasId)).toMatchObject({
          actor: 'user',
          action: 'canvas_delete_layer',
        });
      } finally {
        db.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects a REST body that claims the agent actor', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'paintcodex-actor-'));
    const dbPath = join(directory, 'daemon.db');
    const app = buildServer({ dbPath });

    try {
      const created = await app.inject({
        method: 'POST',
        url: '/paint/canvas',
        payload: { name: 'REST actor boundary' },
      });
      const canvasId = created.json().id as string;

      const rejectedCreate = await app.inject({
        method: 'POST',
        url: `/paint/canvas/${canvasId}/layers`,
        payload: { ...LAYER, expectedRevision: 0, actor: 'agent' },
      });
      expect(rejectedCreate.statusCode).toBe(400);
      expect(rejectedCreate.json()).toMatchObject({
        error: { code: 'invalid_actor' },
      });

      const layer = await app.inject({
        method: 'POST',
        url: `/paint/canvas/${canvasId}/layers`,
        payload: { ...LAYER, expectedRevision: 0 },
      });
      const layerId = layer.json().layers[0].id as string;

      const rejectedUpdate = await app.inject({
        method: 'PATCH',
        url: `/paint/canvas/${canvasId}/layers/${layerId}`,
        payload: { name: 'claimed by agent', expectedRevision: 1, actor: 'agent' },
      });
      expect(rejectedUpdate.statusCode).toBe(400);
      expect(rejectedUpdate.json()).toMatchObject({
        error: { code: 'invalid_actor' },
      });

      const rejectedAction = await app.inject({
        method: 'POST',
        url: `/paint/canvas/${canvasId}/apply-action`,
        payload: {
          actor: 'agent',
          expectedRevision: 1,
          action: {
            type: 'canvas_update_layer',
            layerId,
            patch: { name: 'claimed by agent' },
          },
        },
      });
      expect(rejectedAction.statusCode).toBe(400);
      expect(rejectedAction.json()).toMatchObject({
        error: { code: 'invalid_action' },
      });

      // Nothing was written by the rejected calls, and the legacy explicit
      // `actor:'user'` body is still accepted.
      const accepted = await app.inject({
        method: 'POST',
        url: `/paint/canvas/${canvasId}/apply-action`,
        payload: {
          actor: 'user',
          expectedRevision: 1,
          action: {
            type: 'canvas_update_layer',
            layerId,
            patch: { name: 'accepted' },
          },
        },
      });
      expect(accepted.statusCode).toBe(200);

      const fetched = await app.inject({
        method: 'GET',
        url: `/paint/canvas/${canvasId}`,
      });
      expect(fetched.json()).toMatchObject({
        revision: 2,
        layers: [{ name: 'accepted' }],
      });
      expect(
        app.observability.repository
          .query({ category: 'canvas-action', limit: 200 })
          .items.every((log) => log.actor === 'user'),
      ).toBe(true);
    } finally {
      await app.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('actor attribution through the tool executor', () => {
  it('records agent for create, update and delete snapshots', async () => {
    const seam = buildServiceSeam();
    const safeSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080"><circle cx="10" cy="10" r="5"/></svg>';

    try {
      const canvas = seam.dispatcher.createCanvas({ name: 'Tool canvas' });
      const tools = createCanvasToolSet({
        dispatcher: seam.dispatcher,
        service: seam.service,
      });
      const toolContext = { canvasId: canvas.id, prompt: '画一个圆' };

      const created = await tools.execute(
        'canvas_create_layer',
        { canvasId: canvas.id, name: 'AI circle', svg: safeSvg },
        toolContext,
      );
      expect(created).toMatchObject({ ok: true });
      expect(seam.snapshots.latest(canvas.id)).toMatchObject({
        actor: 'agent',
        action: 'canvas_create_layer',
      });

      const layerId = (created.layer as { id: string }).id;

      const updated = await tools.execute(
        'canvas_update_layer',
        { canvasId: canvas.id, layerId, patch: { name: 'AI circle 2' } },
        toolContext,
      );
      expect(updated).toMatchObject({ ok: true });
      expect(seam.snapshots.latest(canvas.id)).toMatchObject({
        actor: 'agent',
        action: 'canvas_update_layer',
      });

      const deleted = await tools.execute(
        'canvas_delete_layer',
        { canvasId: canvas.id, layerId },
        {
          ...toolContext,
          requestConfirmation: async () => 'approved',
        },
      );
      expect(deleted).toMatchObject({ ok: true });
      expect(seam.snapshots.latest(canvas.id)).toMatchObject({
        actor: 'agent',
        action: 'canvas_delete_layer',
      });
    } finally {
      seam.close();
    }
  });
});

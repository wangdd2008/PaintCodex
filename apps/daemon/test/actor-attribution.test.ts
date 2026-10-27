import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AgentLog, CreateLayerInput } from '@paintcodex/protocol';
import { buildServer } from '../src/api/server.js';
import { createObservability } from '../src/observability/index.js';
import type { AgentLogRepository } from '../src/observability/repository.js';
import { CommandDispatcher } from '../src/paint/command-dispatcher.js';
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
  const dispatcher = new CommandDispatcher(
    new PaintService(
      new CanvasRepository(db),
      new LayerRepository(db),
      snapshots,
      new PaintEvents(),
      observability.logger,
    ),
  );

  return {
    dispatcher,
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
});

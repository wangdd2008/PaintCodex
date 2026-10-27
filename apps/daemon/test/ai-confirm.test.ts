import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/api/server.js';
import {
  createConfirmationChannel,
  type ConfirmFrameEvent,
  type ConfirmationChannel,
  type ConfirmationOutcome,
} from '../src/paint/agent/runtime/confirmation.js';
import { fakeRuntime } from './helpers/fake-runtime.js';

function setup() {
  const confirmations = createConfirmationChannel();
  const app = buildServer({
    runtime: fakeRuntime(async () => ({ text: '', toolCallCount: 0 })),
    dbPath: ':memory:',
    confirmations,
  });

  return { app, confirmations };
}

function openRequest(
  confirmations: ConfirmationChannel,
  canvasId = 'canvas-1',
): { id: string; outcome: Promise<ConfirmationOutcome>; events: ConfirmFrameEvent[] } {
  const events: ConfirmFrameEvent[] = [];
  const outcome = confirmations.requestConfirmation(
    canvasId,
    { title: '删除图层「红圆」', detail: '删除后无法恢复' },
    { onConfirm: (event) => events.push(event) },
  );

  return { id: events[0]?.id as string, outcome, events };
}

describe('POST /paint/ai/confirm', () => {
  it('approves a suspended request and resolves the waiting tool', async () => {
    const { app, confirmations } = setup();
    const { id, outcome } = openRequest(confirmations);

    const response = await app.inject({
      method: 'POST',
      url: '/paint/ai/confirm',
      payload: { requestId: id, approved: true, canvasId: 'canvas-1' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      status: 'approved',
      duplicate: false,
    });
    await expect(outcome).resolves.toBe('approved');

    await app.close();
  });

  it('declines with the same endpoint and reports the outcome', async () => {
    const { app, confirmations } = setup();
    const { id, outcome } = openRequest(confirmations);

    const response = await app.inject({
      method: 'POST',
      url: '/paint/ai/confirm',
      payload: { requestId: id, approved: false },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'declined' });
    await expect(outcome).resolves.toBe('declined');

    await app.close();
  });

  it('returns 404 for an unknown request id', async () => {
    const { app } = setup();

    const response = await app.inject({
      method: 'POST',
      url: '/paint/ai/confirm',
      payload: { requestId: 'does-not-exist', approved: true },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: {
        code: 'confirmation_not_found',
        message: '确认请求不存在或已失效',
      },
    });

    await app.close();
  });

  it('rejects a malformed answer with 400', async () => {
    const { app } = setup();

    for (const payload of [
      {},
      { requestId: 'x' },
      { requestId: 42, approved: true },
      { requestId: 'x', approved: 'yes' },
      { requestId: 'x', approved: true, canvasId: 7 },
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/paint/ai/confirm',
        payload,
      });

      expect(response.statusCode).toBe(400);
    }

    await app.close();
  });

  it('is idempotent: a duplicated answer keeps the first outcome', async () => {
    const { app, confirmations } = setup();
    const { id, outcome } = openRequest(confirmations);

    await app.inject({
      method: 'POST',
      url: '/paint/ai/confirm',
      payload: { requestId: id, approved: false },
    });
    const duplicate = await app.inject({
      method: 'POST',
      url: '/paint/ai/confirm',
      payload: { requestId: id, approved: true },
    });

    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json()).toEqual({
      ok: true,
      status: 'declined',
      duplicate: true,
    });
    await expect(outcome).resolves.toBe('declined');

    await app.close();
  });

  it('cannot approve a request that belongs to another canvas', async () => {
    const { app, confirmations } = setup();
    const { id, outcome } = openRequest(confirmations, 'canvas-1');

    const response = await app.inject({
      method: 'POST',
      url: '/paint/ai/confirm',
      payload: { requestId: id, approved: true, canvasId: 'canvas-2' },
    });

    expect(response.statusCode).toBe(404);
    expect(confirmations.pendingCount()).toBe(1);

    await app.inject({
      method: 'POST',
      url: '/paint/ai/confirm',
      payload: { requestId: id, approved: true, canvasId: 'canvas-1' },
    });
    await expect(outcome).resolves.toBe('approved');

    await app.close();
  });
});

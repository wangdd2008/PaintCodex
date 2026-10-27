import { afterEach, describe, expect, it } from 'vitest';
import type { AgentLog } from '@paintcodex/protocol';
import {
  createConfirmationChannel,
  type ConfirmFrameEvent,
  type ConfirmationChannel,
} from '../src/paint/agent/runtime/confirmation.js';
import { createObservability } from '../src/observability/index.js';
import { openDatabase } from '../src/storage/database.js';

function createHarness(options: { timeoutMs?: number } = {}) {
  const observability = createObservability(openDatabase(':memory:'));
  const channel = createConfirmationChannel({
    timeoutMs: options.timeoutMs ?? 1_000,
    logger: observability.logger,
  });

  return {
    channel,
    logs: (): AgentLog[] =>
      observability.repository.query({ category: 'codex-runtime', limit: 100 }).items,
  };
}

function request(
  channel: ConfirmationChannel,
  canvasId = 'canvas-1',
  title = '删除图层「红圆」',
) {
  const events: ConfirmFrameEvent[] = [];
  const promise = channel.requestConfirmation(
    canvasId,
    { title, detail: '删除后无法恢复' },
    { onConfirm: (event) => events.push(event) },
  );

  return { promise, events };
}

const channels: ConfirmationChannel[] = [];

function harness(options: Parameters<typeof createHarness>[0] = {}) {
  const created = createHarness(options);
  channels.push(created.channel);

  return created;
}

afterEach(() => {
  for (const channel of channels.splice(0)) {
    channel.close();
  }
});

describe('confirmation channel', () => {
  it('emits one confirm frame and resolves approved when the user answers', async () => {
    const { channel, logs } = harness();
    const { promise, events } = request(channel);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id: expect.any(String),
      title: '删除图层「红圆」',
      detail: '删除后无法恢复',
    });
    expect(channel.pendingCount()).toBe(1);

    const id = events[0]?.id as string;

    expect(channel.answer(id, true, 'canvas-1')).toEqual({
      status: 'approved',
      outcome: 'approved',
    });
    await expect(promise).resolves.toBe('approved');
    expect(channel.pendingCount()).toBe(0);
    expect(
      logs().find((record) => record.message === 'confirmation_answered'),
    ).toMatchObject({
      level: 'info',
      canvasId: 'canvas-1',
      payload: { requestId: id, approved: true, outcome: 'approved' },
    });
  });

  it('resolves declined when the user cancels the operation', async () => {
    const { channel } = harness();
    const { promise, events } = request(channel);

    expect(channel.answer(events[0]?.id as string, false, 'canvas-1')).toEqual({
      status: 'declined',
      outcome: 'declined',
    });
    await expect(promise).resolves.toBe('declined');
  });

  it('answers an unknown request id with null and leaves the caller alone', async () => {
    const { channel } = harness();

    expect(channel.answer('missing', true)).toBeNull();
    expect(channel.answer('', true)).toBeNull();
  });

  it('treats a repeated answer as idempotent: the first outcome stands', async () => {
    const { channel } = harness();
    const { promise, events } = request(channel);
    const id = events[0]?.id as string;

    channel.answer(id, false, 'canvas-1');

    expect(channel.answer(id, true, 'canvas-1')).toEqual({
      status: 'duplicate',
      outcome: 'declined',
    });
    await expect(promise).resolves.toBe('declined');
  });

  it('refuses with timeout after the deadline and answers late requests idempotently', async () => {
    const { channel, logs } = harness({ timeoutMs: 20 });
    const { promise, events } = request(channel);

    await expect(promise).resolves.toBe('timeout');
    expect(channel.pendingCount()).toBe(0);
    expect(
      logs().find((record) => record.message === 'confirmation_timeout'),
    ).toMatchObject({ level: 'warn', payload: { requestId: events[0]?.id } });

    expect(channel.answer(events[0]?.id as string, true, 'canvas-1')).toEqual({
      status: 'duplicate',
      outcome: 'timeout',
    });
  });

  it('cancels only the pending requests of the canvas that went away', async () => {
    const { channel, logs } = harness();
    const first = request(channel, 'canvas-1');
    const second = request(channel, 'canvas-2', '删除图层「蓝方」');

    channel.cancelCanvas('canvas-1', 'disconnected');

    await expect(first.promise).resolves.toBe('disconnected');
    expect(channel.pendingCount()).toBe(1);

    channel.cancelCanvas('canvas-2', 'interrupted');

    await expect(second.promise).resolves.toBe('interrupted');
    expect(channel.pendingCount()).toBe(0);
    expect(
      logs().filter((record) => record.message === 'confirmation_cancelled'),
    ).toHaveLength(2);
  });

  it('refuses to answer a request that belongs to another canvas', async () => {
    const { channel, logs } = harness();
    const { promise, events } = request(channel, 'canvas-1');
    const id = events[0]?.id as string;

    expect(channel.answer(id, true, 'canvas-2')).toBeNull();
    expect(channel.pendingCount()).toBe(1);
    expect(
      logs().some((record) => record.message === 'confirmation_canvas_mismatch'),
    ).toBe(true);

    channel.answer(id, false, 'canvas-1');

    await expect(promise).resolves.toBe('declined');
  });

  it('stops waiting when the caller signal aborts', async () => {
    const { channel } = harness();
    const controller = new AbortController();
    const promise = channel.requestConfirmation(
      'canvas-1',
      { title: '删除图层', detail: '删除后无法恢复' },
      { signal: controller.signal },
    );

    controller.abort();

    await expect(promise).resolves.toBe('disconnected');
    expect(channel.pendingCount()).toBe(0);
  });
});

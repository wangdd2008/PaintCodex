import { describe, expect, it } from 'vitest';
import {
  createExportChannel,
  DEFAULT_EXPORT_TIMEOUT_MS,
  type ExportRequest,
} from '../src/paint/agent/runtime/export-png.js';

const REPORT = { filename: '测试画布-canvas-1.png', bytes: 1234 };

function harness(options: { timeoutMs?: number } = {}) {
  const channel = createExportChannel(options);
  const emitted: ExportRequest[] = [];
  const turn = channel.beginTurn((request) => emitted.push(request));

  return { channel, turn, emitted };
}

describe('canvas export channel', () => {
  it('resolves the tool with the filename and size the browser reports, once', async () => {
    const { channel, turn, emitted } = harness();
    const pending = turn.request('canvas-1');

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ canvasId: 'canvas-1' });
    const requestId = emitted[0]!.id;

    expect(channel.deliver(requestId, REPORT)).toEqual({ status: 'accepted' });
    await expect(pending).resolves.toEqual({ ok: true, ...REPORT });

    // A replayed report must not become a second download.
    expect(channel.deliver(requestId, REPORT)).toEqual({ status: 'unknown' });
  });

  it('fails the tool as export_unavailable when the browser misses the deadline', async () => {
    const { channel, turn, emitted } = harness({ timeoutMs: 20 });
    const pending = turn.request('canvas-1');

    await expect(pending).resolves.toMatchObject({
      ok: false,
      code: 'export_unavailable',
    });
    expect(channel.deliver(emitted[0]!.id, REPORT)).toEqual({ status: 'unknown' });
  });

  it('rejects a second concurrent export of the same canvas with export_busy', async () => {
    const { channel, turn, emitted } = harness();
    const first = turn.request('canvas-1');

    await expect(turn.request('canvas-1')).resolves.toMatchObject({
      ok: false,
      code: 'export_busy',
    });
    // The rejected call never reached the browser.
    expect(emitted).toHaveLength(1);

    expect(channel.deliver(emitted[0]!.id, REPORT)).toEqual({ status: 'accepted' });
    await expect(first).resolves.toMatchObject({ ok: true });

    // Once the first export settles the canvas is free again.
    const third = turn.request('canvas-1');

    expect(emitted).toHaveLength(2);
    expect(channel.deliver(emitted[1]!.id, REPORT)).toEqual({ status: 'accepted' });
    await expect(third).resolves.toMatchObject({ ok: true });
  });

  it('reports export_unavailable when the browser says it could not export', async () => {
    const { channel, turn, emitted } = harness();
    const pending = turn.request('canvas-1');

    expect(
      channel.deliver(emitted[0]!.id, { error: '画布尚未准备好导出' }),
    ).toEqual({ status: 'accepted' });
    await expect(pending).resolves.toMatchObject({
      ok: false,
      code: 'export_unavailable',
    });
  });

  it('rejects a malformed report without consuming the request', async () => {
    const { channel, turn, emitted } = harness();
    const pending = turn.request('canvas-1');
    const requestId = emitted[0]!.id;

    for (const report of [
      { filename: '', bytes: 1 },
      { filename: 'x.png', bytes: -1 },
      { filename: 'x.png', bytes: 1.5 },
      { filename: 'x.png' },
    ]) {
      expect(channel.deliver(requestId, report as never)).toEqual({
        status: 'invalid',
      });
    }

    // Still open for the real answer instead of hanging the turn.
    expect(channel.deliver(requestId, REPORT)).toEqual({ status: 'accepted' });
    await expect(pending).resolves.toMatchObject({ ok: true });
  });

  it('fails a pending export when the turn disconnects, and later requests too', async () => {
    const { channel, turn, emitted } = harness();
    const pending = turn.request('canvas-1');

    turn.close();

    expect(channel.deliver(emitted[0]!.id, REPORT)).toEqual({ status: 'unknown' });
    await expect(pending).resolves.toMatchObject({
      ok: false,
      code: 'export_unavailable',
    });
    await expect(turn.request('canvas-1')).resolves.toMatchObject({
      ok: false,
      code: 'export_unavailable',
    });
    expect(emitted).toHaveLength(1);
  });

  it('fails a pending export when the turn signal aborts', async () => {
    const { channel, turn } = harness();
    const controller = new AbortController();
    const pending = turn.request('canvas-1', controller.signal);

    controller.abort();

    await expect(pending).resolves.toMatchObject({
      ok: false,
      code: 'export_unavailable',
    });
  });

  it('keeps the default deadline aligned with the preview round-trip', () => {
    expect(DEFAULT_EXPORT_TIMEOUT_MS).toBe(10_000);
  });
});

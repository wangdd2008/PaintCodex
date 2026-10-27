import { describe, expect, it } from 'vitest';
import {
  createRenderPreviewChannel,
  MAX_RENDER_IMAGE_BYTES,
  type RenderPreviewRequest,
} from '../src/paint/agent/runtime/render-preview.js';

const PNG = 'data:image/png;base64,AAAA';

function harness(options: { timeoutMs?: number; maxImageBytes?: number } = {}) {
  const channel = createRenderPreviewChannel(options);
  const emitted: RenderPreviewRequest[] = [];
  const turn = channel.beginTurn((request) => emitted.push(request));

  return { channel, turn, emitted };
}

describe('render preview channel', () => {
  it('delivers the image of the matching request and consumes it once', async () => {
    const { channel, turn, emitted } = harness();
    const pending = turn.request('canvas-1');

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ canvasId: 'canvas-1' });
    const requestId = emitted[0]!.id;

    expect(channel.deliver(requestId, PNG)).toEqual({ status: 'accepted' });
    await expect(pending).resolves.toEqual({ ok: true, imageUrl: PNG });

    // A second delivery of the same id is stale, not a second success.
    expect(channel.deliver(requestId, PNG)).toEqual({ status: 'unknown' });
  });

  it('resolves the tool with render_unavailable when the browser is too slow', async () => {
    const { channel, turn, emitted } = harness({ timeoutMs: 20 });
    const pending = turn.request('canvas-1');

    await expect(pending).resolves.toMatchObject({
      ok: false,
      code: 'render_unavailable',
    });
    expect(channel.deliver(emitted[0]!.id, PNG)).toEqual({ status: 'unknown' });
  });

  it('rejects an image above the single-image size cap and frees the request', async () => {
    const { channel, turn, emitted } = harness({ maxImageBytes: PNG.length });
    const pending = turn.request('canvas-1');
    const oversized = `${PNG}A`;

    expect(channel.deliver(emitted[0]!.id, oversized)).toMatchObject({
      status: 'too_large',
      maxBytes: PNG.length,
    });
    await expect(pending).resolves.toMatchObject({
      ok: false,
      code: 'render_unavailable',
    });
  });

  it('never lets a stale result satisfy a newer request', async () => {
    const { channel, turn, emitted } = harness({ timeoutMs: 20 });
    const first = turn.request('canvas-1');

    await expect(first).resolves.toMatchObject({ ok: false });
    const staleId = emitted[0]!.id;

    expect(channel.deliver(staleId, PNG)).toEqual({ status: 'unknown' });

    const second = turn.request('canvas-1');
    const freshId = emitted[1]!.id;

    expect(freshId).not.toBe(staleId);
    expect(channel.deliver(staleId, PNG)).toEqual({ status: 'unknown' });
    expect(channel.deliver(freshId, PNG)).toEqual({ status: 'accepted' });
    await expect(second).resolves.toEqual({ ok: true, imageUrl: PNG });
  });

  it('fails pending and later requests when the turn disconnects', async () => {
    const { channel, turn, emitted } = harness();
    const pending = turn.request('canvas-1');

    turn.close();

    expect(channel.deliver(emitted[0]!.id, PNG)).toEqual({ status: 'unknown' });
    await expect(pending).resolves.toMatchObject({
      ok: false,
      code: 'render_unavailable',
    });
    await expect(turn.request('canvas-1')).resolves.toMatchObject({
      ok: false,
      code: 'render_unavailable',
    });
    expect(emitted).toHaveLength(1);
  });

  it('rejects payloads that are not a PNG data URL', async () => {
    const { channel, turn, emitted } = harness();
    const pending = turn.request('canvas-1');

    expect(channel.deliver(emitted[0]!.id, 'https://example.com/canvas.png')).toEqual({
      status: 'invalid',
    });

    // The request stays open for a valid result instead of hanging the turn.
    expect(channel.deliver(emitted[0]!.id, PNG)).toEqual({ status: 'accepted' });
    await expect(pending).resolves.toMatchObject({ ok: true });
  });

  it('keeps the default image cap aligned with the documented limit', () => {
    expect(MAX_RENDER_IMAGE_BYTES).toBe(8 * 1024 * 1024);
  });
});

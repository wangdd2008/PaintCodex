import { describe, expect, it, vi } from 'vitest';
import {
  computeThumbnailCrop,
  THUMBNAIL_TARGET_HEIGHT,
  THUMBNAIL_TARGET_WIDTH,
  ThumbnailScheduler,
  type ThumbnailSnapshot,
} from '../src/services/canvas-thumbnail';

describe('computeThumbnailCrop', () => {
  it('keeps the whole 16:9 canvas and scales it to 320x180', () => {
    const crop = computeThumbnailCrop(1920, 1080);

    expect(crop.left).toBeCloseTo(0);
    expect(crop.top).toBeCloseTo(0);
    expect(crop.width).toBeCloseTo(1920);
    expect(crop.height).toBeCloseTo(1080);
    expect(crop.width * crop.multiplier).toBeCloseTo(THUMBNAIL_TARGET_WIDTH);
    expect(crop.height * crop.multiplier).toBeCloseTo(THUMBNAIL_TARGET_HEIGHT);
  });

  it('center-crops a taller-than-16:9 document vertically', () => {
    const crop = computeThumbnailCrop(1080, 1920);

    // 以宽度为准裁到 16:9 高：1080 * 9/16 = 607.5，上下各裁掉一截。
    expect(crop.width).toBeCloseTo(1080);
    expect(crop.height).toBeCloseTo(607.5);
    expect(crop.left).toBeCloseTo(0);
    expect(crop.top).toBeCloseTo((1920 - 607.5) / 2);
    expect(crop.width * crop.multiplier).toBeCloseTo(THUMBNAIL_TARGET_WIDTH);
    expect(crop.height * crop.multiplier).toBeCloseTo(THUMBNAIL_TARGET_HEIGHT);
  });

  it('center-crops a wider-than-16:9 document horizontally', () => {
    const crop = computeThumbnailCrop(3840, 1080);

    // 以高度为准裁到 16:9 宽：1080 * 16/9 = 1920，左右各裁掉 960。
    expect(crop.height).toBeCloseTo(1080);
    expect(crop.width).toBeCloseTo(1920);
    expect(crop.left).toBeCloseTo((3840 - 1920) / 2);
    expect(crop.top).toBeCloseTo(0);
    expect(crop.width * crop.multiplier).toBeCloseTo(THUMBNAIL_TARGET_WIDTH);
    expect(crop.height * crop.multiplier).toBeCloseTo(THUMBNAIL_TARGET_HEIGHT);
  });
});

/** 可控假时钟：notify 后手动 tick() 才触发防抖回调。 */
function installFakeTimers() {
  let callback: (() => void) | null = null;

  return {
    setTimeout: ((cb: () => void) => {
      callback = cb;
      return 1 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout,
    clearTimeout: (() => {
      callback = null;
    }) as typeof clearTimeout,
    tick: () => {
      const cb = callback;
      callback = null;
      cb?.();
    },
  };
}

interface Harness {
  scheduler: ThumbnailScheduler;
  render: ReturnType<typeof vi.fn>;
  upload: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
  snapshot: ThumbnailSnapshot;
  tick: () => void;
}

function makeHarness(overrides?: Partial<ThumbnailSnapshot>): Harness {
  const timers = installFakeTimers();
  const snapshot: ThumbnailSnapshot = {
    canvasId: 'canvas-1',
    revision: 3,
    ready: true,
    inFlightMutation: false,
    ...overrides,
  };
  const render = vi.fn(() => 'data:image/png;base64,abc');
  const upload = vi.fn(async () => undefined);
  const debug = vi.fn();

  const scheduler = new ThumbnailScheduler({
    getSnapshot: () => snapshot,
    renderDataUrl: render,
    upload,
    debug,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  });

  return { scheduler, render, upload, debug, snapshot, tick: timers.tick };
}

describe('ThumbnailScheduler', () => {
  it('renders and uploads once the canvas is idle for the debounce window', async () => {
    const h = makeHarness();

    h.scheduler.notify();
    expect(h.upload).not.toHaveBeenCalled();

    h.tick();
    await Promise.resolve();

    expect(h.render).toHaveBeenCalledTimes(1);
    expect(h.upload).toHaveBeenCalledWith('canvas-1', 'data:image/png;base64,abc', 3);
    expect(h.debug).not.toHaveBeenCalled();
  });

  it('skips a revision that was already uploaded (switch/refresh does not re-upload)', async () => {
    const h = makeHarness();

    h.scheduler.notify();
    h.tick();
    await Promise.resolve();
    expect(h.upload).toHaveBeenCalledTimes(1);

    // 同一张画布、同一个 revision 再 notify（例如切走又切回）——不再上传。
    h.scheduler.notify();
    h.tick();
    await Promise.resolve();
    expect(h.upload).toHaveBeenCalledTimes(1);
    expect(h.render).toHaveBeenCalledTimes(1);
  });

  it('uploads again only when the revision changes', async () => {
    const h = makeHarness();

    h.scheduler.notify();
    h.tick();
    await Promise.resolve();
    expect(h.upload).toHaveBeenCalledTimes(1);

    h.snapshot.revision = 4;
    h.scheduler.notify();
    h.tick();
    await Promise.resolve();

    expect(h.upload).toHaveBeenCalledTimes(2);
    expect(h.upload).toHaveBeenLastCalledWith(
      'canvas-1',
      'data:image/png;base64,abc',
      4,
    );
  });

  it('waits while a mutation is in flight, then uploads once it drains', async () => {
    const h = makeHarness({ inFlightMutation: true });

    h.scheduler.notify();
    h.tick();
    await Promise.resolve();
    expect(h.upload).not.toHaveBeenCalled();

    // mutation 结束，重新 notify。
    h.snapshot.inFlightMutation = false;
    h.scheduler.notify();
    h.tick();
    await Promise.resolve();

    expect(h.upload).toHaveBeenCalledTimes(1);
  });

  it('does not upload until the fabric canvas is ready', async () => {
    const h = makeHarness({ ready: false });

    h.scheduler.notify();
    h.tick();
    await Promise.resolve();
    expect(h.upload).not.toHaveBeenCalled();
    expect(h.render).not.toHaveBeenCalled();
  });

  it('swallows upload failures as debug logs and leaves the revision unrecorded', async () => {
    const h = makeHarness();
    h.upload.mockRejectedValueOnce(new Error('network down'));

    h.scheduler.notify();
    h.tick();
    await Promise.resolve();

    expect(h.debug).toHaveBeenCalledTimes(1);
    expect(h.debug.mock.calls[0]?.[0]).toMatch(/缩略图上传失败/);

    // 失败后不记 revision：下一次 notify 会重试。
    h.scheduler.notify();
    h.tick();
    await Promise.resolve();
    expect(h.upload).toHaveBeenCalledTimes(2);
  });
});

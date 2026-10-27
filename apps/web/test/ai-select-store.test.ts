// @vitest-environment jsdom
import type { CanvasDocument, Layer } from '@paintcodex/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AI_SELECTION_DURATION_MS,
  useCanvasStore,
} from '../src/services/canvas-store';

const LAYER: Layer = {
  id: 'layer-1',
  canvasId: 'canvas-1',
  name: '红圆',
  type: 'vector',
  zIndex: 0,
  visible: true,
  opacity: 1,
  content: { kind: 'fabric', json: '{"type":"path"}' },
  metadata: { createdBy: 'user', createdAt: 1 },
  createdAt: 1,
};

function canvasDocument(): CanvasDocument {
  return {
    id: 'canvas-1',
    name: '测试画布',
    width: 1920,
    height: 1080,
    backgroundColor: '#ffffff',
    revision: 2,
    createdAt: 1,
    updatedAt: 2,
    history: { canUndo: true, canRedo: false },
    layers: [LAYER],
  };
}

function resetStore(): void {
  useCanvasStore.setState({
    canvas: null,
    status: 'idle',
    activeLayerId: null,
    activeLayerRequest: 0,
    aiSelection: null,
    isDrawing: false,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  useCanvasStore.setState({
    canvas: canvasDocument(),
    status: 'ready',
    activeLayerId: null,
    activeLayerRequest: 0,
    aiSelection: null,
    isDrawing: false,
  });
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  resetStore();
});

describe('canvas_select 的 web 侧状态', () => {
  it('makes the selected layer active without replaying an explicit click', () => {
    const requestsBefore = useCanvasStore.getState().activeLayerRequest;

    useCanvasStore
      .getState()
      .selectFromAi({ canvasId: 'canvas-1', layerId: LAYER.id });

    const state = useCanvasStore.getState();

    expect(state.activeLayerId).toBe(LAYER.id);
    // An explicit click also bumps this counter, which switches the tool and
    // repaints the stroke. The AI signal must not do either.
    expect(state.activeLayerRequest).toBe(requestsBefore);
    expect(state.aiSelection).toMatchObject({
      canvasId: 'canvas-1',
      layerId: LAYER.id,
    });
  });

  it('drops the highlight after three seconds but keeps the active layer', () => {
    useCanvasStore
      .getState()
      .selectFromAi({ canvasId: 'canvas-1', layerId: LAYER.id });

    vi.advanceTimersByTime(AI_SELECTION_DURATION_MS - 1);
    expect(useCanvasStore.getState().aiSelection).not.toBeNull();

    vi.advanceTimersByTime(1);
    expect(useCanvasStore.getState().aiSelection).toBeNull();
    expect(useCanvasStore.getState().activeLayerId).toBe(LAYER.id);
  });

  it('replays the highlight for a repeated selection of the same layer', () => {
    useCanvasStore
      .getState()
      .selectFromAi({ canvasId: 'canvas-1', layerId: LAYER.id });
    const first = useCanvasStore.getState().aiSelection?.nonce;

    useCanvasStore
      .getState()
      .selectFromAi({ canvasId: 'canvas-1', layerId: LAYER.id });

    expect(useCanvasStore.getState().aiSelection?.nonce).toBe(
      (first ?? 0) + 1,
    );
  });

  it('ignores a signal for another canvas or an unknown layer', () => {
    useCanvasStore
      .getState()
      .selectFromAi({ canvasId: 'canvas-2', layerId: LAYER.id });
    useCanvasStore
      .getState()
      .selectFromAi({ canvasId: 'canvas-1', layerId: 'missing' });

    expect(useCanvasStore.getState().activeLayerId).toBeNull();
    expect(useCanvasStore.getState().aiSelection).toBeNull();
  });
});

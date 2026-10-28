// @vitest-environment jsdom
import type { CanvasDocument } from '@paintcodex/protocol';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CanvasStage } from '../src/features/canvas/CanvasStage';
import {
  AI_SELECTION_DURATION_MS,
  useCanvasStore,
} from '../src/services/canvas-store';
import { useToolStore } from '../src/services/tool-store';

/** jsdom has no 2D context; the double keeps the surface CanvasStage touches. */
const fabricDouble = vi.hoisted(() => {
  type Handler = (event: unknown) => void;

  class FakeCanvas {
    static instances: FakeCanvas[] = [];

    isDrawingMode = false;
    selection = false;
    freeDrawingBrush: { color: string; width: number } | null = null;
    handlers = new Map<string, Handler>();
    activeObject: unknown = null;

    constructor() {
      FakeCanvas.instances.push(this);
    }

    on(name: string, handler: Handler): void {
      this.handlers.set(name, handler);
    }

    off(name: string): void {
      this.handlers.delete(name);
    }

    add(): void {}

    remove(): void {}

    setActiveObject(object: unknown): void {
      this.activeObject = object;
    }

    discardActiveObject(): void {
      this.activeObject = null;
    }

    requestRenderAll(): void {}

    setDimensions() {}
    setViewportTransform() {}
    zoomToPoint() {}
    relativePan() {}

    async dispose(): Promise<void> {}
  }

  /** A layer's object reports where it sits on the canvas (100, 50, 200 × 100). */
  class FakeObject {
    selectable = false;
    evented = false;
    visible = true;
    opacity = 1;

    set(props: Record<string, unknown>): this {
      Object.assign(this, props);
      return this;
    }

    getBoundingRect() {
      return { left: 100, top: 50, width: 200, height: 100 };
    }

    toSVG(): string {
      return '<path />';
    }
  }

  return {
    FakeCanvas,
    enlivenObjects: async (values: unknown[]) =>
      values.map(() => new FakeObject()),
  };
});

vi.mock('fabric', () => ({
  Canvas: fabricDouble.FakeCanvas,
  PencilBrush: class {
    color = '#111111';
    width = 6;
  },
  loadSVGFromString: vi.fn(),
  util: {
    enlivenObjects: fabricDouble.enlivenObjects,
    groupSVGElements: vi.fn(),
  },
}));

const CANVAS_WIDTH = 1000;
const CANVAS_HEIGHT = 500;

function canvasDocument(): CanvasDocument {
  return {
    id: 'canvas-1',
    name: '测试画布',
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    backgroundColor: '#ffffff',
    revision: 2,
    createdAt: 1,
    updatedAt: 2,
    history: { canUndo: false, canRedo: false },
    layers: [
      {
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
      },
    ],
  };
}

function canvasDouble() {
  const instance = fabricDouble.FakeCanvas.instances[0];

  if (!instance) {
    throw new Error('CanvasStage did not create a fabric canvas');
  }

  return instance;
}

/** The cue is decorative (aria-hidden), so the test looks it up by its class. */
function highlightOverlay(container: HTMLElement): HTMLElement | null {
  return container.querySelector('.canvas-ai-highlight');
}

/** The layer object is registered asynchronously, after the canvas mounts. */
async function flushObjects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  fabricDouble.FakeCanvas.instances.length = 0;
  useToolStore.setState({ tool: 'brush' });
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
  cleanup();
  vi.useRealTimers();
  fabricDouble.FakeCanvas.instances.length = 0;
});

describe('CanvasStage 的 canvas_select 高亮', () => {
  it('圈出 AI 指示的区域，三秒后淡出', async () => {
    vi.useFakeTimers();
    const { container } = render(<CanvasStage />);
    await flushObjects();

    act(() => {
      useCanvasStore.getState().selectFromAi({
        canvasId: 'canvas-1',
        region: { x: 100, y: 50, width: 200, height: 100 },
      });
    });

    const highlight = highlightOverlay(container);

    expect(highlight?.style.left).toBe('10%');
    expect(highlight?.style.top).toBe('10%');
    expect(highlight?.style.width).toBe('20%');
    expect(highlight?.style.height).toBe('20%');

    act(() => {
      vi.advanceTimersByTime(AI_SELECTION_DURATION_MS);
    });

    expect(highlightOverlay(container)).toBeNull();
  });

  it('按图层对象的实际位置高亮，而不是整块画布', async () => {
    const { container } = render(<CanvasStage />);
    await flushObjects();

    act(() => {
      useCanvasStore.getState().selectFromAi({
        canvasId: 'canvas-1',
        layerId: 'layer-1',
      });
    });

    const highlight = highlightOverlay(container);

    // FakeObject: left 100 / top 50 / 200 × 100 on a 1000 × 500 canvas.
    expect(highlight?.style.left).toBe('10%');
    expect(highlight?.style.top).toBe('10%');
    expect(highlight?.style.width).toBe('20%');
    expect(highlight?.style.height).toBe('20%');
  });

  it('正在画的一笔不被打断：不切工具、不退出绘制模式，高亮等笔画结束', async () => {
    const { container } = render(<CanvasStage />);
    await flushObjects();

    const canvas = canvasDouble();

    act(() => {
      canvas.handlers.get('mouse:down')?.({});
    });

    expect(useCanvasStore.getState().isDrawing).toBe(true);

    act(() => {
      useCanvasStore.getState().selectFromAi({
        canvasId: 'canvas-1',
        layerId: 'layer-1',
      });
    });

    // 选中立即生效，但当前笔画不受影响。
    expect(useCanvasStore.getState().activeLayerId).toBe('layer-1');
    expect(canvas.isDrawingMode).toBe(true);
    expect(useToolStore.getState().tool).toBe('brush');
    expect(highlightOverlay(container)).toBeNull();

    act(() => {
      canvas.handlers.get('mouse:up')?.({});
    });

    expect(useCanvasStore.getState().isDrawing).toBe(false);
    expect(highlightOverlay(container)).not.toBeNull();
  });
});

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
    // 视口矩阵：默认单位矩阵（jsdom 测不到容器尺寸，fit 回退为 1）。
    viewportTransform: number[] = [1, 0, 0, 1, 0, 0];

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

    setViewportTransform(vpt: number[]): void {
      this.viewportTransform = [...vpt];
    }

    zoomToPoint() {}
    relativePan() {}

    // 缩略图调度器会在假时间器推进时调用；双不需要真渲染。
    toDataURL(): string {
      return 'data:image/png;base64,';
    }

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

    // 单位视口矩阵（jsdom 容器尺寸为 0，fit 回退 1）：文档像素即屏幕像素。
    // 区域 (100,50,200×100) → 绝对像素定位，不再是百分比。
    expect(highlight?.style.left).toBe('100px');
    expect(highlight?.style.top).toBe('50px');
    expect(highlight?.style.width).toBe('200px');
    expect(highlight?.style.height).toBe('100px');

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

    // FakeObject: left 100 / top 50 / 200 × 100（文档坐标），单位矩阵 → 同值像素。
    expect(highlight?.style.left).toBe('100px');
    expect(highlight?.style.top).toBe('50px');
    expect(highlight?.style.width).toBe('200px');
    expect(highlight?.style.height).toBe('100px');
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

  it('缩放/平移后高亮在同一帧跟随视口，不跳位（②05）', async () => {
    const { container } = render(<CanvasStage />);
    await flushObjects();

    act(() => {
      useCanvasStore.getState().selectFromAi({
        canvasId: 'canvas-1',
        region: { x: 100, y: 50, width: 200, height: 100 },
      });
    });

    let highlight = highlightOverlay(container);
    expect(highlight?.style.left).toBe('100px');

    // 模拟缩放到 200% 并平移 (10,10)：Fabric 重绘后触发 after:render，
    // 组件读当前 viewportTransform 把文档矩形重算成屏幕像素。
    const canvas = canvasDouble();
    act(() => {
      canvas.viewportTransform = [2, 0, 0, 2, 10, 10];
      canvas.handlers.get('after:render')?.({});
    });

    highlight = highlightOverlay(container);
    // 左上：100*2+10=210、50*2+10=110；宽高 200*2=400、100*2=200
    expect(highlight?.style.left).toBe('210px');
    expect(highlight?.style.top).toBe('110px');
    expect(highlight?.style.width).toBe('400px');
    expect(highlight?.style.height).toBe('200px');
  });

  it('高亮 3px 边框是固定 CSS，组件不内联缩放它（②05）', async () => {
    const { container } = render(<CanvasStage />);
    await flushObjects();

    act(() => {
      useCanvasStore.getState().selectFromAi({
        canvasId: 'canvas-1',
        region: { x: 100, y: 50, width: 200, height: 100 },
      });
    });

    // 组件只写 left/top/width/height，绝不内联 border；边框宽度由
    // .canvas-ai-highlight 的固定 3px 类决定，因此不随缩放变粗。
    expect(highlightOverlay(container)?.style.borderWidth).toBe('');
  });

  it('3 秒内再次 AI 指示（nonce 递增）刷新高亮，旧计时器不误清（②05 沿用）', async () => {
    vi.useFakeTimers();
    const { container } = render(<CanvasStage />);
    await flushObjects();

    act(() => {
      useCanvasStore.getState().selectFromAi({
        canvasId: 'canvas-1',
        region: { x: 100, y: 50, width: 200, height: 100 },
      });
    });
    expect(highlightOverlay(container)?.style.left).toBe('100px');

    // 过 2 秒（未到期），再来一个不同区域的指示：nonce 递增，旧计时器被取消。
    act(() => {
      vi.advanceTimersByTime(2000);
      useCanvasStore.getState().selectFromAi({
        canvasId: 'canvas-1',
        region: { x: 300, y: 200, width: 40, height: 60 },
      });
    });
    expect(highlightOverlay(container)?.style.left).toBe('300px');

    // 又过 2 秒：距第二次共 2 秒，新高亮仍在；第一次的 3 秒计时器已被取消。
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(highlightOverlay(container)).not.toBeNull();

    // 再走满第二次剩余的 1 秒，高亮到期消失。
    act(() => {
      vi.advanceTimersByTime(AI_SELECTION_DURATION_MS - 2000);
    });
    expect(highlightOverlay(container)).toBeNull();
  });
});

// @vitest-environment jsdom
import type { CanvasDocument, Layer } from '@paintcodex/protocol';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CanvasStage } from '../src/features/canvas/CanvasStage';
import { useCanvasStore } from '../src/services/canvas-store';
import { useToolStore } from '../src/services/tool-store';
import { useViewportStore } from '../src/services/viewport-store';

/**
 * 沿用 canvas-brush.test.tsx 的 fabric 双：jsdom 没有 2D context，Fabric 跑不起来。
 * 这里把视口相关的方法（setDimensions/setViewportTransform/zoomToPoint/relativePan）
 * 录下来，断言组件接线正确，不断言真实渲染。
 */
const fabricDouble = vi.hoisted(() => {
  type Handler = (event: unknown) => void;

  class FakeCanvas {
    static instances: FakeCanvas[] = [];

    isDrawingMode = false;
    selection = false;
    freeDrawingBrush: { color: string; width: number } | null = null;
    viewportTransform: number[] = [1, 0, 0, 1, 0, 0];
    setDimensionsCalls: Array<{ width: number; height: number }> = [];
    setViewportTransformCalls: Array<number[]> = [];
    zoomToPointCalls: Array<{ x: number; y: number; value: number }> = [];
    relativePanCalls: Array<{ x: number; y: number }> = [];
    handlers = new Map<string, Handler>();

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

    discardActiveObject(): void {}

    requestRenderAll(): void {}

    setDimensions(dim: { width: number; height: number }): void {
      this.setDimensionsCalls.push({ width: dim.width, height: dim.height });
    }

    setViewportTransform(vpt: number[]): void {
      this.setViewportTransformCalls.push([...vpt]);
      this.viewportTransform = [...vpt];
    }

    zoomToPoint(point: { x: number; y: number }, value: number): void {
      this.zoomToPointCalls.push({ x: point.x, y: point.y, value });
      this.setViewportTransform([
        value,
        0,
        0,
        value,
        this.viewportTransform[4] ?? 0,
        this.viewportTransform[5] ?? 0,
      ]);
    }

    relativePan(point: { x: number; y: number }): void {
      this.relativePanCalls.push({ x: point.x, y: point.y });
    }

    async dispose(): Promise<void> {}
  }

  class FakePoint {
    constructor(public x = 0, public y = 0) {}
  }

  return { FakeCanvas, FakePoint };
});

vi.mock('fabric', () => ({
  Canvas: fabricDouble.FakeCanvas,
  Point: fabricDouble.FakePoint,
  PencilBrush: class {
    color = '#000000';
    width = 1;
  },
  loadSVGFromString: vi.fn(),
  util: {
    enlivenObjects: async (values: unknown[]) =>
      values.map(() => ({ set(): void {}, toSVG: (): string => '' })),
    groupSVGElements: vi.fn(),
  },
}));

const EMPTY_LAYER: Layer = {
  id: 'layer-1',
  canvasId: 'canvas-1',
  name: '笔迹 1',
  type: 'vector',
  zIndex: 0,
  visible: true,
  opacity: 1,
  content: { kind: 'fabric', json: '{}' },
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
    revision: 3,
    createdAt: 1,
    updatedAt: 2,
    history: { canUndo: true, canRedo: false },
    layers: [EMPTY_LAYER],
  };
}

/** 容器测到 800×600：fitScale = min(800/1920, 600/1080) = 5/12 ≈ 0.4167。 */
const CONTAINER_W = 800;
const CONTAINER_H = 600;

beforeEach(() => {
  fabricDouble.FakeCanvas.instances.length = 0;
  useViewportStore.setState({ zoomPercent: null });
  useToolStore.setState({ tool: 'brush', brushColor: '#111111', brushWidth: 6 });
  useCanvasStore.setState({
    canvas: canvasDocument(),
    status: 'ready',
    error: null,
    saving: false,
    activeLayerId: null,
  });
  // jsdom 不布局：给视口一个固定容器尺寸。
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    value: CONTAINER_W,
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    value: CONTAINER_H,
  });
});

afterEach(() => {
  cleanup();
});

function mountedCanvas(): InstanceType<typeof fabricDouble.FakeCanvas> {
  const instance = fabricDouble.FakeCanvas.instances[0];

  if (!instance) {
    throw new Error('CanvasStage did not create a fabric canvas');
  }

  return instance;
}

describe('Fabric 真缩放与平移（②04）', () => {
  it('挂载时把 Fabric 尺寸设为容器像素，并以 fit 矩阵居中', () => {
    render(<CanvasStage />);
    const canvas = mountedCanvas();

    expect(canvas.setDimensionsCalls).toContainEqual({
      width: CONTAINER_W,
      height: CONTAINER_H,
    });

    const vpt = canvas.setViewportTransformCalls.at(-1)!;
    // s = 5/12 ≈ 0.4167；宽受限：水平贴边 offsetX=0，垂直居中 offsetY=(600-450)/2=75
    expect(vpt[0]).toBeCloseTo(5 / 12, 4);
    expect(vpt[4]).toBe(0);
    expect(vpt[5]).toBeCloseTo(75, 4);
  });

  it('状态栏百分比来自当前 scale，而不是 ResizeObserver 反推', () => {
    render(<CanvasStage />);
    expect(useViewportStore.getState().zoomPercent).toBeCloseTo(41.7, 1);
  });

  it('「+」按钮以容器中心为锚点放大，并把百分比推进 store', () => {
    render(<CanvasStage />);
    const canvas = mountedCanvas();

    fireEvent.click(screen.getByRole('button', { name: '放大' }));

    const last = canvas.zoomToPointCalls.at(-1)!;
    // 0.4167 * 1.2 = 0.5
    expect(last.value).toBeCloseTo(0.5, 3);
    expect(useViewportStore.getState().zoomPercent).toBeCloseTo(50, 1);
  });

  it('「适应窗口」重新按容器 fit，并回到 fit 模式', () => {
    render(<CanvasStage />);
    const canvas = mountedCanvas();
    const before = canvas.setViewportTransformCalls.length;

    fireEvent.click(screen.getByRole('button', { name: '适应窗口' }));

    expect(canvas.setViewportTransformCalls.length).toBeGreaterThan(before);
    const vpt = canvas.setViewportTransformCalls.at(-1)!;
    expect(vpt[0]).toBeCloseTo(5 / 12, 4);
  });

  it('滚轮以指针为中心缩放，scale 被夹在 [0.05, 8]', () => {
    render(<CanvasStage />);
    const canvas = mountedCanvas();
    const frame = document.querySelector('.canvas-frame')!;

    fireEvent.wheel(frame, { deltaY: -1, clientX: 400, clientY: 300 });

    const last = canvas.zoomToPointCalls.at(-1)!;
    // 0.4167 * 1.1 ≈ 0.4583，未触上限
    expect(last.value).toBeCloseTo(0.4167 * 1.1, 3);
  });

  it('四个控件都可聚焦、有中文 aria-label', () => {
    render(<CanvasStage />);

    expect(screen.getByRole('toolbar', { name: '画布缩放控制' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '适应窗口' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '缩放到 100%' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '缩小' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '放大' })).toBeTruthy();
  });
});

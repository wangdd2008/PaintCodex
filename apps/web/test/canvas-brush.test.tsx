// @vitest-environment jsdom
import type { CanvasDocument, CreateLayerInput, Layer } from '@paintcodex/protocol';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CanvasStage } from '../src/features/canvas/CanvasStage';
import { Toolbox } from '../src/features/toolbox/Toolbox';
import { useCanvasStore } from '../src/services/canvas-store';
import {
  DEFAULT_BRUSH_COLOR,
  DEFAULT_BRUSH_WIDTH,
  useToolStore,
} from '../src/services/tool-store';

/**
 * jsdom has no 2D context, so fabric itself cannot run here. The double keeps
 * exactly the surface CanvasStage uses: the free-drawing brush and the
 * `path:created` event that carries the serialized stroke to the daemon.
 */
const fabricDouble = vi.hoisted(() => {
  type Handler = (event: unknown) => void;

  class FakeCanvas {
    static instances: FakeCanvas[] = [];

    isDrawingMode = false;
    selection = false;
    freeDrawingBrush: { color: string; width: number } | null = null;
    viewportTransform: number[] = [1, 0, 0, 1, 0, 0];
    added: unknown[] = [];
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

    add(object: unknown): void {
      this.added.push(object);
    }

    remove(): void {}

    discardActiveObject(): void {}

    requestRenderAll(): void {}

    // 视口接线（②04）在挂载时就调用；笔刷测试只关心笔画，这些留空即可。
    setDimensions(): void {}

    setViewportTransform(vpt: number[]): void {
      this.viewportTransform = [...vpt];
    }

    zoomToPoint(_point: unknown, value: number): void {
      this.viewportTransform[0] = value;
    }

    relativePan(): void {}

    async dispose(): Promise<void> {}
  }

  return {
    FakeCanvas,
    enlivenObjects: async (values: unknown[]) =>
      values.map(() => ({ set(): void {}, toSVG: (): string => '' })),
  };
});

vi.mock('fabric', () => ({
  Canvas: fabricDouble.FakeCanvas,
  PencilBrush: class {
    color = '#000000';
    width = 1;
  },
  loadSVGFromString: vi.fn(),
  util: {
    enlivenObjects: fabricDouble.enlivenObjects,
    groupSVGElements: vi.fn(),
  },
}));

const EXISTING_STROKE = JSON.stringify({
  type: 'path',
  stroke: '#111111',
  strokeWidth: DEFAULT_BRUSH_WIDTH,
  path: [['M', 0, 0], ['L', 24, 24]],
});

const EXISTING_LAYER: Layer = {
  id: 'layer-1',
  canvasId: 'canvas-1',
  name: '笔迹 1',
  type: 'vector',
  zIndex: 0,
  visible: true,
  opacity: 1,
  content: { kind: 'fabric', json: EXISTING_STROKE },
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
    layers: [EXISTING_LAYER],
  };
}

/** Mirrors the daemon: append the posted layer and bump the revision. */
function stubLayerApi(base: CanvasDocument) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const input = JSON.parse(String(init?.body)) as CreateLayerInput & {
      expectedRevision?: number;
    };
    const created: Layer = {
      id: `layer-${base.layers.length + 1}`,
      canvasId: base.id,
      name: input.name,
      type: input.type,
      zIndex: base.layers.length,
      visible: true,
      opacity: 1,
      content: input.content,
      metadata: { createdBy: 'user', createdAt: 1 },
      createdAt: 1,
    };
    const next: CanvasDocument = {
      ...base,
      revision: base.revision + 1,
      layers: [...base.layers, created],
    };

    return { ok: true, status: 200, json: async () => next } as unknown as Response;
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** A stroke whose serialized payload reflects the brush that drew it. */
class FakeStroke {
  constructor(private readonly brush: { color: string; width: number }) {}

  set(): void {}

  toJSON() {
    return {
      type: 'path',
      stroke: this.brush.color,
      strokeWidth: this.brush.width,
      path: [['M', 10, 10]],
    };
  }
}

function canvasDouble() {
  const instance = fabricDouble.FakeCanvas.instances[0];

  if (!instance) {
    throw new Error('CanvasStage did not create a fabric canvas');
  }

  return instance;
}

beforeEach(() => {
  fabricDouble.FakeCanvas.instances.length = 0;
  useToolStore.setState({
    tool: 'brush',
    brushColor: DEFAULT_BRUSH_COLOR,
    brushWidth: DEFAULT_BRUSH_WIDTH,
  });
  useCanvasStore.setState({
    canvas: canvasDocument(),
    status: 'ready',
    error: null,
    saving: false,
    activeLayerId: null,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('CanvasStage brush settings', () => {
  it('draws with the default #111111 / 6 until the user picks something else', async () => {
    const fetchMock = stubLayerApi(canvasDocument());
    render(<CanvasStage />);

    const canvas = canvasDouble();
    const brush = canvas.freeDrawingBrush;
    expect(brush?.color).toBe('#111111');
    expect(brush?.width).toBe(6);

    canvas.handlers.get('path:created')?.({ path: new FakeStroke(brush!) });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));

    expect(JSON.parse(payload.content.json)).toMatchObject({
      stroke: '#111111',
      strokeWidth: 6,
    });
  });

  it('persists new strokes with the picked color and width, leaving existing layers untouched', async () => {
    const fetchMock = stubLayerApi(canvasDocument());
    render(
      <>
        <Toolbox />
        <CanvasStage />
      </>,
    );

    const canvas = canvasDouble();
    const brush = canvas.freeDrawingBrush;

    fireEvent.click(screen.getByRole('button', { name: '红色' }));
    fireEvent.click(screen.getByRole('button', { name: '笔宽 8' }));

    expect(brush?.color).toBe('#dc2626');
    expect(brush?.width).toBe(8);
    // Choosing a color/width must not rewrite anything on its own.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(useCanvasStore.getState().canvas?.layers[0]?.content).toEqual({
      kind: 'fabric',
      json: EXISTING_STROKE,
    });

    canvas.handlers.get('path:created')?.({ path: new FakeStroke(brush!) });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    const payload = JSON.parse(String(init?.body));

    expect(url).toBe('/paint/canvas/canvas-1/layers');
    expect(payload.expectedRevision).toBe(3);
    expect(JSON.parse(payload.content.json)).toMatchObject({
      stroke: '#dc2626',
      strokeWidth: 8,
    });

    const stored = useCanvasStore.getState().canvas;
    expect(stored?.layers).toHaveLength(2);
    expect(stored?.layers[0]?.content).toEqual({ kind: 'fabric', json: EXISTING_STROKE });
    expect(stored?.layers[1]?.content).toEqual(payload.content);
  });
});

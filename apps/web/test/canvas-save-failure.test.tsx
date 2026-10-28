// @vitest-environment jsdom
import type { CanvasDocument, Layer } from '@paintcodex/protocol';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CanvasStage } from '../src/features/canvas/CanvasStage';
import { useCanvasStore } from '../src/services/canvas-store';

interface FakeCanvas {
  handlers: Map<string, (event: { path: FakePath }) => void>;
  remove: ReturnType<typeof vi.fn>;
  add: ReturnType<typeof vi.fn>;
  requestRenderAll: ReturnType<typeof vi.fn>;
  discardActiveObject: ReturnType<typeof vi.fn>;
}

interface FakePath {
  toJSON: () => unknown;
  set: ReturnType<typeof vi.fn>;
}

const { canvasInstances } = vi.hoisted(() => ({ canvasInstances: [] as FakeCanvas[] }));

vi.mock('fabric', () => {
  class MockCanvas {
    handlers = new Map();
    isDrawingMode = false;
    selection = true;
    freeDrawingBrush: unknown = null;
    remove = vi.fn();
    add = vi.fn();
    requestRenderAll = vi.fn();
    discardActiveObject = vi.fn();
    setDimensions = vi.fn();
    setViewportTransform = vi.fn();
    zoomToPoint = vi.fn();
    relativePan = vi.fn();
    // 缩略图调度器在真实定时器里调用；双不需要真渲染。
    toDataURL = vi.fn(() => 'data:image/png;base64,');

    constructor() {
      canvasInstances.push(this as unknown as FakeCanvas);
    }

    on(event: string, handler: (event: { path: FakePath }) => void) {
      this.handlers.set(event, handler);
    }

    off() {}
    dispose() {
      return Promise.resolve();
    }
  }

  class MockPencilBrush {
    color = '';
    width = 0;
  }

  return {
    Canvas: MockCanvas,
    PencilBrush: MockPencilBrush,
    loadSVGFromString: async () => ({ objects: [], options: {} }),
    util: {
      enlivenObjects: async () => [],
      groupSVGElements: () => null,
    },
  };
});

function canvasDocument(overrides: Partial<CanvasDocument> = {}): CanvasDocument {
  return {
    id: 'canvas-1',
    name: '测试画布',
    width: 1920,
    height: 1080,
    backgroundColor: '#ffffff',
    revision: 1,
    createdAt: 0,
    updatedAt: 0,
    history: { canUndo: false, canRedo: false },
    layers: [],
    ...overrides,
  };
}

function makeLayer(json: string): Layer {
  return {
    id: 'layer-1',
    canvasId: 'canvas-1',
    name: 'Stroke 1',
    type: 'vector',
    zIndex: 0,
    visible: true,
    opacity: 1,
    content: { kind: 'fabric', json },
    metadata: { createdBy: 'user', createdAt: 0 },
    createdAt: 0,
  };
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response;
}

function resetStore(): void {
  useCanvasStore.setState({
    canvas: null,
    status: 'idle',
    error: null,
    requestedCanvasId: null,
    saving: false,
    saveState: 'idle',
    lastSavedAt: null,
    saveError: null,
    unsavedStrokes: 0,
    canvasAlert: null,
    canvasRetry: null,
    activeLayerId: null,
  });
}

async function mountReadyCanvas(): Promise<{
  canvas: FakeCanvas;
  path: FakePath;
}> {
  const { container } = render(<CanvasStage />);
  await waitFor(() => expect(canvasInstances).toHaveLength(1));
  const canvas = canvasInstances[0]!;
  const path: FakePath = {
    toJSON: () => ({ type: 'path', path: [['M', 0, 0]] }),
    set: vi.fn(),
  };

  expect(container.querySelector('.canvas-hint')).toBeNull();

  return { canvas, path };
}

beforeEach(() => {
  canvasInstances.length = 0;
  resetStore();
  useCanvasStore.setState({ canvas: canvasDocument(), status: 'ready' });
  window.localStorage.clear();
  window.history.replaceState({}, '', '/');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('保存失败保留笔画', () => {
  it('daemon 不可达时笔画仍在画布上，并出现可重试横幅', async () => {
    const fetchMock = vi.fn(
      async (_url: RequestInfo | URL, init?: RequestInit) => {
        if ((init?.method ?? 'GET') === 'POST') {
          throw new TypeError('Failed to fetch');
        }

        return jsonResponse(canvasDocument());
      },
    );
    vi.stubGlobal('fetch', fetchMock);

    const { canvas, path } = await mountReadyCanvas();

    act(() => {
      canvas.handlers.get('path:created')?.({ path });
    });

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('这一笔未保存');
    expect(alert.textContent).toContain('无法连接本地服务');
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy();

    // The stroke object was not removed and is visibly marked as unsaved.
    expect(canvas.remove).not.toHaveBeenCalled();
    expect(path.set).toHaveBeenCalledWith(
      expect.objectContaining({ opacity: expect.any(Number) }),
    );
    expect(useCanvasStore.getState().unsavedStrokes).toBe(1);
    expect(useCanvasStore.getState().canvas?.layers).toHaveLength(0);

    // A successful refresh is a read, not a retry: the mutation banner stays.
    await act(async () => {
      await useCanvasStore.getState().refreshCanvas();
    });
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(useCanvasStore.getState().canvasAlert).toContain('这一笔未保存');
  });

  it('重试成功后横幅消失、笔画进入快照、状态回到已保存', async () => {
    let allowSave = false;
    let savedCanvas = canvasDocument();
    const fetchMock = vi.fn(
      async (_url: RequestInfo | URL, init?: RequestInit) => {
        if ((init?.method ?? 'GET') === 'POST') {
          if (!allowSave) {
            throw new TypeError('Failed to fetch');
          }

          savedCanvas = canvasDocument({
            revision: 2,
            layers: [makeLayer(JSON.stringify({ type: 'path', path: [['M', 0, 0]] }))],
          });
        }

        return jsonResponse(savedCanvas);
      },
    );
    vi.stubGlobal('fetch', fetchMock);

    const { canvas, path } = await mountReadyCanvas();

    act(() => {
      canvas.handlers.get('path:created')?.({ path });
    });
    await screen.findByRole('alert');

    allowSave = true;
    fireEvent.click(screen.getByRole('button', { name: '重试' }));

    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    await waitFor(() =>
      expect(useCanvasStore.getState().canvas?.layers).toHaveLength(1),
    );

    const state = useCanvasStore.getState();
    expect(state.saveState).toBe('saved');
    expect(state.unsavedStrokes).toBe(0);
    expect(state.canvasAlert).toBeNull();
    expect(canvas.remove).not.toHaveBeenCalled();
    expect(path.set).toHaveBeenCalledWith(
      expect.objectContaining({ opacity: 1 }),
    );
  });

  it('无法与服务端快照对齐时移除笔画，但横幅明说「这一笔未保存」', async () => {
    let allowSave = false;
    let savedCanvas = canvasDocument();
    const mismatchedJson = JSON.stringify({ type: 'path', path: [['M', 9, 9]] });
    const fetchMock = vi.fn(
      async (_url: RequestInfo | URL, init?: RequestInit) => {
        if ((init?.method ?? 'GET') === 'POST') {
          if (!allowSave) {
            throw new TypeError('Failed to fetch');
          }

          savedCanvas = canvasDocument({
            revision: 2,
            layers: [makeLayer(mismatchedJson)],
          });
        }

        return jsonResponse(savedCanvas);
      },
    );
    vi.stubGlobal('fetch', fetchMock);

    const { canvas, path } = await mountReadyCanvas();

    act(() => {
      canvas.handlers.get('path:created')?.({ path });
    });
    await screen.findByRole('alert');

    allowSave = true;
    fireEvent.click(screen.getByRole('button', { name: '重试' }));

    await waitFor(() => expect(canvas.remove).toHaveBeenCalledWith(path));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('这一笔未保存');
    expect(alert.textContent).toContain('无法与服务端快照对齐');
  });
});

// @vitest-environment jsdom
import type { CanvasDocument, Layer } from '@paintcodex/protocol';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CanvasStage } from '../src/features/canvas/CanvasStage';
import {
  DELETE_RESTORE_TIMEOUT_MS,
  LayerPanel,
} from '../src/features/layer-panel/LayerPanel';
import { useCanvasStore } from '../src/services/canvas-store';
import { useToolStore } from '../src/services/tool-store';

/**
 * jsdom 没有真实 Fabric：这里只关心两件事——删除后行/恢复条的状态，
 * 以及撤销后 Fabric 画布上的对象是否回到删除前（像素的替身）。
 */
const { canvasInstances } = vi.hoisted(() => ({ canvasInstances: [] as any[] }));

vi.mock('fabric', () => {
  type Handler = (event: any) => void;

  class MockCanvas {
    handlers = new Map<string, Handler>();
    objects: any[] = [];
    isDrawingMode = false;
    selection = true;
    freeDrawingBrush: unknown = null;
    activeObject: any = null;

    constructor() {
      canvasInstances.push(this);
    }

    on(event: string, handler: Handler) {
      this.handlers.set(event, handler);
    }

    off(event: string) {
      this.handlers.delete(event);
    }

    add(object: any) {
      this.objects.push(object);
    }

    remove(object: any) {
      this.objects = this.objects.filter((entry) => entry !== object);
    }

    setActiveObject(object: any) {
      this.activeObject = object;
    }

    discardActiveObject() {
      this.activeObject = null;
    }

    requestRenderAll() {}

    dispose() {
      return Promise.resolve();
    }
  }

  class MockPencilBrush {
    color = '';
    width = 0;
  }

  function makeObject(source: string) {
    return {
      source,
      visible: true,
      opacity: 1,
      stroke: '#111111',
      strokeWidth: 4,
      selectable: false,
      evented: false,
      set(props: Record<string, unknown>) {
        Object.assign(this, props);
        return this;
      },
      toSVG() {
        return `<path data-source="${source}" />`;
      },
    };
  }

  return {
    Canvas: MockCanvas,
    PencilBrush: MockPencilBrush,
    loadSVGFromString: async () => ({ objects: [], options: {} }),
    util: {
      enlivenObjects: async (entries: Array<{ id?: string }>) =>
        entries.map((entry) => makeObject(entry.id ?? '')),
      groupSVGElements: (objects: any[]) => objects[0] ?? null,
    },
  };
});

function makeLayer(index: number, overrides: Partial<Layer> = {}): Layer {
  return {
    id: `layer-${index}`,
    canvasId: 'canvas-1',
    name: `笔迹 ${index}`,
    type: 'vector',
    zIndex: index,
    visible: true,
    opacity: 1,
    content: { kind: 'fabric', json: JSON.stringify({ id: `layer-${index}` }) },
    metadata: { createdBy: 'user', createdAt: 0 },
    createdAt: 0,
    ...overrides,
  };
}

function makeCanvas(layers: Layer[], revision = 1): CanvasDocument {
  return {
    id: 'canvas-1',
    name: '测试画布',
    width: 1280,
    height: 720,
    backgroundColor: '#ffffff',
    revision,
    createdAt: 0,
    updatedAt: 0,
    layers,
    history: { canUndo: false, canRedo: false },
  };
}

function seedCanvas(layers: Layer[], revision = 1): void {
  useCanvasStore.setState({
    canvas: makeCanvas(layers, revision),
    status: 'ready',
    activeLayerId: layers.at(-1)?.id ?? null,
    activeLayerRequest: 0,
    saving: false,
    saveState: 'idle',
    lastSavedAt: null,
    saveError: null,
    unsavedStrokes: 0,
    canvasAlert: null,
    canvasRetry: null,
  });
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response;
}

function fabricCanvas(): any {
  return canvasInstances[0];
}

function normalizedText(element: Element): string {
  return (element.textContent ?? '').replace(/\s+/g, ' ').trim();
}

async function flushMicrotasks(times = 30): Promise<void> {
  await act(async () => {
    for (let index = 0; index < times; index += 1) {
      await Promise.resolve();
    }
  });
}

function renderPanelOnly() {
  return render(<LayerPanel />);
}

function renderPanelAndCanvas() {
  return render(
    <>
      <LayerPanel />
      <CanvasStage />
    </>,
  );
}

beforeEach(() => {
  canvasInstances.length = 0;
  useCanvasStore.setState({ canvas: null, status: 'idle', activeLayerId: null });
  useToolStore.setState({ tool: 'brush' });

  // jsdom 不实现滚动；撤销把图层加回来时面板会调用它。
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  canvasInstances.length = 0;
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
    activeLayerRequest: 0,
  });
});

describe('删除恢复条', () => {
  it('删除即时生效：不再弹原生确认，行消失并出现恢复条', async () => {
    const layers = [makeLayer(1), makeLayer(2)];
    seedCanvas(layers);
    const fetchMock = vi.fn(
      async (_url: string, init?: RequestInit) =>
        init?.method === 'DELETE'
          ? jsonResponse(makeCanvas([layers[0]!], 2))
          : jsonResponse(makeCanvas(layers)),
    );
    vi.stubGlobal('fetch', fetchMock);
    const confirmSpy = vi.spyOn(window, 'confirm');

    renderPanelOnly();

    fireEvent.click(screen.getByRole('button', { name: '删除 笔迹 2' }));

    // 一次往返：请求返回后才移除行，不存在「先消失再回来」。
    await waitFor(() =>
      expect(screen.queryByRole('option', { name: /笔迹 2/ })).toBeNull(),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('DELETE');
    expect(confirmSpy).not.toHaveBeenCalled();

    const bar = screen.getByRole('status');
    expect(normalizedText(bar)).toContain('已删除「笔迹 2」· 撤销');
    expect(screen.getByRole('button', { name: '撤销' })).toBeTruthy();
  });

  it('恢复条 8 秒后自动消失', async () => {
    vi.useFakeTimers();

    const layers = [makeLayer(1), makeLayer(2)];
    seedCanvas(layers);
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'DELETE'
        ? jsonResponse(makeCanvas([layers[0]!], 2))
        : jsonResponse(makeCanvas(layers)),
    );
    vi.stubGlobal('fetch', fetchMock);

    renderPanelOnly();

    fireEvent.click(screen.getByRole('button', { name: '删除 笔迹 2' }));
    await flushMicrotasks();

    expect(screen.getByRole('status')).toBeTruthy();

    await act(async () => {
      vi.advanceTimersByTime(DELETE_RESTORE_TIMEOUT_MS - 1);
    });
    expect(screen.getByRole('status')).toBeTruthy();

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('点撤销后名称、可见性、内容与画布对象回到删除前', async () => {
    const layers = [makeLayer(1), makeLayer(2, { visible: false })];
    seedCanvas(layers);
    const afterDelete = makeCanvas([layers[0]!], 2);
    const afterUndo = makeCanvas(layers, 3);
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        return jsonResponse(afterDelete);
      }

      if (url.endsWith('/undo')) {
        return jsonResponse(afterUndo);
      }

      throw new Error(`未预期的请求：${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPanelAndCanvas();

    await waitFor(() => expect(fabricCanvas().objects).toHaveLength(2));
    const beforeSources = fabricCanvas()
      .objects.map((object: any) => object.source)
      .sort();

    fireEvent.click(screen.getByRole('button', { name: '删除 笔迹 2' }));

    await waitFor(() =>
      expect(screen.queryByRole('option', { name: /笔迹 2/ })).toBeNull(),
    );
    await waitFor(() =>
      expect(fabricCanvas().objects.map((object: any) => object.source)).toEqual([
        'layer-1',
      ]),
    );

    fireEvent.click(screen.getByRole('button', { name: '撤销' }));

    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2));

    // 像素的替身：Fabric 画布上的对象与删除前完全一致。
    await waitFor(() =>
      expect(
        fabricCanvas()
          .objects.map((object: any) => object.source)
          .sort(),
      ).toEqual(beforeSources),
    );

    const restored = useCanvasStore.getState().canvas?.layers ?? [];
    expect(restored.map((layer) => layer.id)).toEqual(['layer-1', 'layer-2']);
    expect(restored[1]?.name).toBe('笔迹 2');
    expect(restored[1]?.visible).toBe(false);
    expect(restored[1]?.content).toEqual(layers[1]!.content);
    expect(screen.queryByRole('status')).toBeNull();

    // 撤销绑定删除产生的 revision（2），不是删除前的 revision（1）。
    const undoCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith('/undo'),
    );
    expect(JSON.parse(String(undoCall?.[1]?.body))).toEqual({
      expectedRevision: 2,
    });
  });

  it('删除后再画一笔，恢复条降级为不可点的纯文本', async () => {
    const layers = [makeLayer(1), makeLayer(2)];
    seedCanvas(layers);
    const afterDelete = makeCanvas([layers[0]!], 2);
    const strokeJson = JSON.stringify({ type: 'path', path: [['M', 0, 0]] });
    const strokeLayer = makeLayer(3, {
      content: { kind: 'fabric', json: strokeJson },
    });
    const afterStroke = makeCanvas([layers[0]!, strokeLayer], 3);
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        return jsonResponse(afterDelete);
      }

      if (url.endsWith('/layers')) {
        return jsonResponse(afterStroke);
      }

      throw new Error(`未预期的请求：${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPanelAndCanvas();

    fireEvent.click(screen.getByRole('button', { name: '删除 笔迹 2' }));

    await waitFor(() =>
      expect(screen.queryByRole('option', { name: /笔迹 2/ })).toBeNull(),
    );
    expect(normalizedText(screen.getByRole('status'))).toContain(
      '已删除「笔迹 2」· 撤销',
    );

    // 再画一笔走的是同一条 createLayer mutation。
    const path = {
      set: vi.fn(),
      toJSON: () => ({ type: 'path', path: [['M', 0, 0]] }),
    };
    act(() => {
      fabricCanvas().handlers.get('path:created')?.({ path });
    });

    await waitFor(() =>
      expect(useCanvasStore.getState().canvas?.revision).toBe(3),
    );

    const degraded = screen.getByRole('status');
    expect(normalizedText(degraded)).toContain(
      '已删除「笔迹 2」· 已有后续操作',
    );
    expect(screen.queryByRole('button', { name: '撤销' })).toBeNull();
  });

  it('连续删除只保留最近一条恢复条', async () => {
    const layers = [makeLayer(1), makeLayer(2), makeLayer(3)];
    seedCanvas(layers);
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        return jsonResponse(
          String(url).includes('layer-3')
            ? makeCanvas([layers[0]!, layers[1]!], 2)
            : makeCanvas([layers[0]!], 3),
        );
      }

      throw new Error(`未预期的请求：${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPanelOnly();

    fireEvent.click(screen.getByRole('button', { name: '删除 笔迹 3' }));
    await waitFor(() =>
      expect(normalizedText(screen.getByRole('status'))).toContain(
        '已删除「笔迹 3」',
      ),
    );

    fireEvent.click(screen.getByRole('button', { name: '删除 笔迹 2' }));
    await waitFor(() =>
      expect(screen.queryByRole('option', { name: /笔迹 2/ })).toBeNull(),
    );

    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(normalizedText(screen.getByRole('status'))).toContain(
      '已删除「笔迹 2」',
    );
    expect(screen.queryByText(/已删除「笔迹 3」/)).toBeNull();
  });

  it('删除失败时就地显示原因与重试，行不消失，重试成功后出现恢复条', async () => {
    const layers = [makeLayer(1), makeLayer(2)];
    seedCanvas(layers);
    let failDelete = true;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        if (failDelete) {
          throw new TypeError('Failed to fetch');
        }

        return jsonResponse(makeCanvas([layers[0]!], 2));
      }

      throw new Error('未预期的请求');
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPanelAndCanvas();

    fireEvent.click(screen.getByRole('button', { name: '删除 笔迹 2' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('无法删除图层');
    expect(alert.textContent).toContain('无法连接本地服务');
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy();

    // 没有「看起来删掉了但刷新又回来」：失败时行与快照都没变。
    expect(screen.getByRole('option', { name: /笔迹 2/ })).toBeTruthy();
    expect(useCanvasStore.getState().canvas?.layers).toHaveLength(2);
    expect(screen.queryByRole('status')).toBeNull();

    failDelete = false;
    fireEvent.click(screen.getByRole('button', { name: '重试' }));

    await waitFor(() =>
      expect(screen.queryByRole('option', { name: /笔迹 2/ })).toBeNull(),
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expect(normalizedText(screen.getByRole('status'))).toContain(
      '已删除「笔迹 2」',
    );
  });
});

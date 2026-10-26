// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CanvasDocument, Layer } from '@paintcodex/protocol';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/App';
import { CanvasStage } from '../src/features/canvas/CanvasStage';
import { LayerPanel } from '../src/features/layer-panel/LayerPanel';
import { useCanvasStore } from '../src/services/canvas-store';
import { useToolStore } from '../src/services/tool-store';

const testDir = dirname(fileURLToPath(import.meta.url));
const layerPanelCss = readFileSync(
  resolve(testDir, '../src/features/layer-panel/layer-panel.css'),
  'utf8',
);

/**
 * jsdom 里没有真实 Fabric 与布局，所以两层契约分开验：
 * - Fabric 侧用记录调用的替身，断言选中/高亮/写回走的是哪条路径；
 * - 焦点环与对比度直接读样式表里的数值。
 */
const fabricMock = vi.hoisted(() => ({
  canvases: [] as any[],
  objects: [] as any[],
}));

vi.mock('fabric', () => {
  type Listener = (event: any) => void;

  class MockCanvas {
    isDrawingMode = false;
    selection = true;
    freeDrawingBrush: unknown = null;
    activeObject: any = null;
    added: any[] = [];
    private listeners = new Map<string, Listener[]>();

    constructor() {
      fabricMock.canvases.push(this);
    }

    on(event: string, listener: Listener) {
      const list = this.listeners.get(event) ?? [];
      list.push(listener);
      this.listeners.set(event, list);
    }

    off(event: string, listener: Listener) {
      const list = this.listeners.get(event) ?? [];
      this.listeners.set(
        event,
        list.filter((entry) => entry !== listener),
      );
    }

    add(object: any) {
      this.added.push(object);
    }

    remove(object: any) {
      this.added = this.added.filter((entry) => entry !== object);
    }

    setActiveObject(object: any) {
      this.activeObject = object;
    }

    discardActiveObject() {
      this.activeObject = null;
    }

    requestRenderAll() {}

    emit(event: string, payload: any) {
      for (const listener of this.listeners.get(event) ?? []) {
        listener(payload);
      }
    }

    dispose() {
      return Promise.resolve();
    }
  }

  class MockPencilBrush {
    color = '';
    width = 0;
  }

  function createMockObject(source: string) {
    const object: any = {
      source,
      stroke: '#111111',
      strokeWidth: 4,
      visible: true,
      opacity: 1,
      selectable: false,
      evented: false,
      set(props: Record<string, unknown>) {
        Object.assign(object, props);
        return object;
      },
      toSVG() {
        return `<path data-source="${source}" />`;
      },
    };

    fabricMock.objects.push(object);
    return object;
  }

  return {
    Canvas: MockCanvas,
    PencilBrush: MockPencilBrush,
    loadSVGFromString: async (svg: string) => ({
      objects: [createMockObject(svg)],
      options: {},
    }),
    util: {
      enlivenObjects: async (entries: Array<{ id?: string }>) =>
        entries.map((entry) => createMockObject(entry.id ?? '')),
      groupSVGElements: (objects: any[]) => objects[0] ?? null,
    },
  };
});

function makeLayer(
  index: number,
  type: Layer['type'] = 'vector',
  overrides: Partial<Layer> = {},
): Layer {
  return {
    id: `layer-${index}`,
    canvasId: 'canvas-1',
    name: `笔迹 ${index}`,
    type,
    zIndex: index,
    visible: true,
    opacity: 1,
    content:
      type === 'ai-generated'
        ? { kind: 'svg', svg: `<svg><g id="layer-${index}" /></svg>` }
        : { kind: 'fabric', json: JSON.stringify({ id: `layer-${index}` }) },
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

function seedCanvas(
  layers: Layer[],
  activeLayerId: string | null = layers.at(-1)?.id ?? null,
): void {
  useCanvasStore.setState({
    canvas: makeCanvas(layers),
    status: 'ready',
    saving: false,
    activeLayerId,
    activeLayerRequest: 0,
  });
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response;
}

function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));

  if (!match?.[1]) {
    throw new Error(`样式文件里找不到规则: ${selector}`);
  }

  return match[1];
}

function colorOf(rule: string, property: string): string {
  const match = rule.match(
    new RegExp(`${property}\\s*:\\s*[^;]*?(#[0-9a-fA-F]{6})`),
  );

  if (!match?.[1]) {
    throw new Error(`规则里找不到颜色: ${property}`);
  }

  return match[1];
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });

  return (
    0.2126 * (channels[0] ?? 0) +
    0.7152 * (channels[1] ?? 0) +
    0.0722 * (channels[2] ?? 0)
  );
}

function contrastRatio(first: string, second: string): number {
  const [lighter, darker] = [luminance(first), luminance(second)].sort(
    (left, right) => right - left,
  ) as [number, number];

  return (lighter + 0.05) / (darker + 0.05);
}

async function waitForCanvasSurface(objectCount: number): Promise<any> {
  await waitFor(() => {
    expect(fabricMock.canvases).toHaveLength(1);
    expect(fabricMock.canvases[0].added).toHaveLength(objectCount);
  });

  return fabricMock.canvases[0];
}

function resetStore(): void {
  useCanvasStore.setState({
    canvas: null,
    status: 'idle',
    error: null,
    requestedCanvasId: null,
    saving: false,
    activeLayerId: null,
    activeLayerRequest: 0,
  });
  useToolStore.setState({ tool: 'brush' });
}

beforeEach(() => {
  fabricMock.canvases.length = 0;
  fabricMock.objects.length = 0;
  resetStore();
  window.localStorage.clear();
  window.history.replaceState({}, '', '/');

  // jsdom 不实现滚动；图层面板新增图层时会调用它。
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
  Object.defineProperty(Element.prototype, 'scrollTo', {
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
  resetStore();
});

describe('图层行的键盘导航与选中', () => {
  it('列表是 listbox，行是 option，只有当前行进入 Tab 顺序', () => {
    seedCanvas(
      [makeLayer(1), makeLayer(2), makeLayer(3)],
      'layer-2',
    );

    render(createElement(LayerPanel));

    const list = screen.getByRole('listbox', { name: '图层列表' });
    expect(list.getAttribute('aria-orientation')).toBe('vertical');

    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(3);
    expect(options.map((option) => option.getAttribute('aria-selected'))).toEqual([
      'false',
      'true',
      'false',
    ]);
    // Roving tabindex：Tab 只停在当前行，不会把每一行都变成 tab stop。
    expect(options.map((option) => option.tabIndex)).toEqual([-1, 0, -1]);
  });

  it('↑/↓/Home/End 移动焦点，且不改变选中', () => {
    seedCanvas([makeLayer(1), makeLayer(2), makeLayer(3)], 'layer-2');
    render(createElement(LayerPanel));

    const options = screen.getAllByRole('option');
    options[1]?.focus();
    expect(document.activeElement).toBe(options[1]);

    fireEvent.keyDown(options[1]!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(options[2]);
    expect(useCanvasStore.getState().activeLayerId).toBe('layer-2');

    fireEvent.keyDown(options[2]!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(options[1]);

    fireEvent.keyDown(options[1]!, { key: 'Home' });
    expect(document.activeElement).toBe(options[0]);

    fireEvent.keyDown(options[0]!, { key: 'End' });
    expect(document.activeElement).toBe(options[2]);

    // 焦点所在行成为唯一的 Tab 停靠点。
    expect(
      screen.getAllByRole('option').map((option) => option.tabIndex),
    ).toEqual([-1, -1, 0]);
  });

  it('Enter 与 Space 选中聚焦的图层，aria-selected 随之更新', () => {
    seedCanvas([makeLayer(1), makeLayer(2), makeLayer(3)], 'layer-2');
    render(createElement(LayerPanel));

    const options = screen.getAllByRole('option');
    options[0]?.focus();
    fireEvent.keyDown(options[0]!, { key: 'Enter' });

    expect(useCanvasStore.getState().activeLayerId).toBe('layer-1');
    expect(
      screen.getAllByRole('option').map((option) => option.getAttribute('aria-selected')),
    ).toEqual(['true', 'false', 'false']);

    options[2]?.focus();
    fireEvent.keyDown(options[2]!, { key: ' ' });

    expect(useCanvasStore.getState().activeLayerId).toBe('layer-3');
    expect(
      screen.getAllByRole('option').map((option) => option.getAttribute('aria-selected')),
    ).toEqual(['false', 'false', 'true']);
  });

  it('行内可见性与删除按钮不会触发整行选中', async () => {
    const layers = [makeLayer(1), makeLayer(2)];
    seedCanvas(layers, 'layer-1');
    const remaining = makeCanvas([layers[0]!], 2);
    const fetchMock = vi.fn(
      async (_url: string, init?: RequestInit) =>
        init?.method === 'DELETE'
          ? jsonResponse(remaining)
          : jsonResponse(makeCanvas(layers)),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(createElement(LayerPanel));

    const before = useCanvasStore.getState().activeLayerId;
    const visibility = screen.getByRole('button', { name: '笔迹 2 可见性' });

    fireEvent.click(visibility);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(useCanvasStore.getState().activeLayerId).toBe(before);

    // 按钮上的 Space 属于按钮自己，不能冒泡成「选中该行」。
    fireEvent.keyDown(visibility, { key: ' ' });
    expect(useCanvasStore.getState().activeLayerId).toBe(before);

    // 票 10：删除不再弹原生确认，直接发请求。
    fireEvent.click(screen.getByRole('button', { name: '删除 笔迹 2' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe('DELETE');
    expect(useCanvasStore.getState().activeLayerId).toBe(before);
  });

  it('Delete 键直接删除聚焦图层，不再弹原生确认', async () => {
    const layers = [makeLayer(1), makeLayer(2)];
    seedCanvas(layers, 'layer-1');
    const remaining = makeCanvas([layers[0]!], 2);
    const fetchMock = vi.fn(
      async (_url: string, init?: RequestInit) =>
        init?.method === 'DELETE' ? jsonResponse(remaining) : jsonResponse(makeCanvas(layers)),
    );
    vi.stubGlobal('fetch', fetchMock);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(createElement(LayerPanel));

    const options = screen.getAllByRole('option');
    options[1]?.focus();
    fireEvent.keyDown(options[1]!, { key: 'Enter' });
    expect(useCanvasStore.getState().activeLayerId).toBe('layer-2');

    fireEvent.keyDown(options[1]!, { key: 'Delete' });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('DELETE');
    await waitFor(() =>
      expect(screen.getAllByRole('option')).toHaveLength(1),
    );
    expect(useCanvasStore.getState().activeLayerId).toBe('layer-1');
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('读屏名称包含名称、类型、可见性；选中态由 aria-selected 表达', () => {
    seedCanvas(
      [makeLayer(1), makeLayer(2, 'ai-generated'), makeLayer(3, 'raster', { visible: false })],
      'layer-2',
    );

    render(createElement(LayerPanel));

    expect(screen.getByRole('option', { name: '笔迹 1，笔迹，可见' })).toBeTruthy();
    expect(screen.getByRole('option', { name: '笔迹 2，AI 生成，可见' })).toBeTruthy();
    expect(screen.getByRole('option', { name: '笔迹 3，位图，已隐藏' })).toBeTruthy();

    const selected = screen.getByRole('option', { selected: true });
    expect(selected.getAttribute('aria-label')).toBe('笔迹 2，AI 生成，可见');
  });

  it('行焦点环为 2px、offset 2px，且与行底色对比 ≥3:1', () => {
    const row = ruleBody(layerPanelCss, '.layer-item');
    const activeRow = ruleBody(layerPanelCss, '.layer-item--active');
    const focusRing = ruleBody(layerPanelCss, '.layer-item:focus-visible');

    expect(focusRing).toMatch(/outline:\s*2px\s+solid\s+#[0-9a-f]{6}/i);
    expect(focusRing).toMatch(/outline-offset:\s*2px/);

    const ringColor = colorOf(focusRing, 'outline');
    const rowBackground = colorOf(row, 'background');
    const activeBackground = colorOf(activeRow, 'background');

    expect(contrastRatio(ringColor, rowBackground)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(ringColor, activeBackground)).toBeGreaterThanOrEqual(3);
  });
});

describe('CanvasStage 选中图层语义', () => {
  it('选中 AI 图层后它成为 Fabric activeObject，并进入选择工具', async () => {
    seedCanvas([makeLayer(1), makeLayer(2, 'ai-generated')], 'layer-1');
    render(createElement(CanvasStage));

    const canvas = await waitForCanvasSurface(2);
    expect(useToolStore.getState().tool).toBe('brush');

    act(() => {
      useCanvasStore.getState().setActiveLayer('layer-2');
    });

    await waitFor(() => expect(useToolStore.getState().tool).toBe('select'));
    await waitFor(() => expect(canvas.activeObject?.source).toContain('layer-2'));

    const object = fabricMock.objects.find((entry) =>
      String(entry.source).includes('layer-2'),
    );
    expect(object?.selectable).toBe(true);
  });

  it('选中笔迹图层后高亮 800ms 再恢复，且不写服务端', async () => {
    seedCanvas([makeLayer(1)]);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(createElement(CanvasStage));

    await waitForCanvasSurface(1);
    const object = fabricMock.objects.find((entry) => entry.source === 'layer-1');
    expect(object?.stroke).toBe('#111111');
    expect(object?.strokeWidth).toBe(4);

    vi.useFakeTimers();

    act(() => {
      useCanvasStore.getState().setActiveLayer('layer-1');
    });

    expect(object?.stroke).not.toBe('#111111');
    expect(object?.strokeWidth).toBeGreaterThan(4);

    // 700ms 时仍在高亮，900ms 时必须恢复：覆盖 800ms ±100ms 的窗口。
    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(object?.stroke).not.toBe('#111111');

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(object?.stroke).toBe('#111111');
    expect(object?.strokeWidth).toBe(4);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('AI 图层的变换结果写回 SVG 内容', async () => {
    const aiLayer = makeLayer(1, 'ai-generated');
    seedCanvas([aiLayer], 'layer-1');
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) => jsonResponse(makeCanvas([aiLayer])),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(createElement(CanvasStage));

    const canvas = await waitForCanvasSurface(1);
    act(() => {
      useCanvasStore.getState().setActiveLayer('layer-1');
    });
    await waitFor(() => expect(canvas.activeObject?.source).toContain('layer-1'));

    act(() => {
      canvas.emit('object:modified', { target: canvas.activeObject });
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/paint/canvas/canvas-1/layers/layer-1');
    expect(init?.method).toBe('PATCH');

    const body = JSON.parse(String(init?.body)) as {
      content: { kind: string; svg: string };
    };
    expect(body.content.kind).toBe('svg');
    expect(body.content.svg).toContain('<svg');
  });
});

describe('图层管理的整条键盘路径', () => {
  it('Tab → ↓ → Enter → Delete → Ctrl+Z 后图层数量与可见性回到原状', async () => {
    const layers = [makeLayer(1), makeLayer(2)];
    seedCanvas(layers, 'layer-1');
    const afterDelete = makeCanvas([layers[0]!], 2);
    const afterUndo = makeCanvas(layers, 3);
    const fetchMock = vi.fn(
      async (url: string, init?: RequestInit) => {
        if (init?.method === 'DELETE') {
          return jsonResponse(afterDelete);
        }

        if (url.endsWith('/undo')) {
          return jsonResponse(afterUndo);
        }

        throw new Error(`未预期的请求: ${url}`);
      },
    );
    vi.stubGlobal('fetch', fetchMock);

    class MockEventSource {
      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      addEventListener() {}
      close() {}
    }

    vi.stubGlobal('EventSource', MockEventSource);

    render(createElement(App));

    // Tab 进入列表：选中行是唯一的 tab stop。
    const selected = screen.getByRole('option', { selected: true });
    expect(selected.tabIndex).toBe(0);
    selected.focus();
    expect(document.activeElement).toBe(selected);

    fireEvent.keyDown(selected, { key: 'ArrowDown' });
    const second = screen.getAllByRole('option')[1]!;
    expect(document.activeElement).toBe(second);

    fireEvent.keyDown(second, { key: 'Enter' });
    expect(useCanvasStore.getState().activeLayerId).toBe('layer-2');

    fireEvent.keyDown(second, { key: 'Delete' });

    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1));
    expect(useCanvasStore.getState().canvas?.layers[0]?.visible).toBe(true);

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });

    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2));
    const restored = useCanvasStore.getState().canvas?.layers ?? [];
    expect(restored.map((layer) => layer.id)).toEqual(['layer-1', 'layer-2']);
    expect(restored.every((layer) => layer.visible)).toBe(true);
  });
});

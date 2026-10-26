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
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
 * jsdom 没有真实 Fabric。这里需要两种替身能力：
 * - 画布对象记录 `opacity`，用来断言「拖动只改本地预览」；
 * - 画布本身记录装载/移除，用来确认预览与快照同步没有互相清空。
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

function deferredResponse() {
  let resolve!: (value: Response) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Response>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

function fabricCanvas(): any {
  return canvasInstances[0];
}

function objectFor(source: string): any {
  return fabricCanvas()?.objects.find((object: any) => object.source === source);
}

/**
 * 每行都有「不透明度 100%」按钮，所以按行限定查询。
 * 展开后 focus 落在滑块上，返回该行的 range 输入。
 */
function openOpacityFor(layerRow: number): HTMLInputElement {
  const row = screen.getAllByRole('option')[layerRow]!;
  fireEvent.click(within(row).getByRole('button', { name: /^不透明度 / }));

  return screen.getByRole('slider') as HTMLInputElement;
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

function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));

  if (!match?.[1]) {
    throw new Error(`样式文件里找不到规则: ${selector}`);
  }

  return match[1];
}

function px(rule: string, property: string): number {
  const match = rule.match(
    new RegExp(`(?:^|[;\\s])${property}\\s*:\\s*(-?\\d+(?:\\.\\d+)?)px`),
  );

  return match?.[1] ? Number(match[1]) : 0;
}

function pxProperty(rule: string, properties: string[]): number {
  return Math.max(...properties.map((property) => px(rule, property)));
}

beforeEach(() => {
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
  useToolStore.setState({ tool: 'brush' });

  // jsdom 不实现滚动；图层面板新增/恢复图层时会调用它。
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
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

describe('图层行内重命名', () => {
  it('双击名称进入编辑，Esc 取消：不产生 PATCH，名称不变', () => {
    seedCanvas([makeLayer(1), makeLayer(2)]);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderPanelOnly();

    fireEvent.doubleClick(screen.getByText('笔迹 1'));

    const input = screen.getByRole('textbox', { name: '重命名 笔迹 1' });
    expect((input as HTMLInputElement).value).toBe('笔迹 1');

    fireEvent.change(input, { target: { value: '背景' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    // 取消后回到只读行，原名原样保留，一次请求都没发。
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText('笔迹 1')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Enter 提交：PATCH 只带 name 与 expectedRevision，成功后名称来自快照', async () => {
    const layers = [makeLayer(1), makeLayer(2)];
    seedCanvas(layers);
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse(
        makeCanvas([{ ...layers[0]!, name: '背 景' }, layers[1]!], 2),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderPanelOnly();

    fireEvent.doubleClick(screen.getByText('笔迹 1'));
    const input = screen.getByRole('textbox', { name: '重命名 笔迹 1' });
    // 首尾空白与连续空白在提交前归一化。
    fireEvent.change(input, { target: { value: '  背  景  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(screen.getByText('背 景')).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/paint/canvas/canvas-1/layers/layer-1');
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(String(init?.body))).toEqual({
      name: '背 景',
      expectedRevision: 1,
    });
    expect(useCanvasStore.getState().canvas?.revision).toBe(2);
    expect(useCanvasStore.getState().canvas?.layers[0]?.name).toBe('背 景');
  });

  it('空值提交回退原名、不发请求，并用画布横幅说明原因', () => {
    seedCanvas([makeLayer(1)]);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderPanelAndCanvas();

    fireEvent.doubleClick(screen.getByText('笔迹 1'));
    const input = screen.getByRole('textbox', { name: '重命名 笔迹 1' });
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText('笔迹 1')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('图层名称不能为空');
  });

  it('PATCH 失败：乐观名称撤回原名，原因与重试落在画布顶部横幅', async () => {
    seedCanvas([makeLayer(1)]);
    const pending = deferredResponse();
    const fetchMock = vi.fn(() => pending.promise);
    vi.stubGlobal('fetch', fetchMock);
    renderPanelAndCanvas();

    fireEvent.doubleClick(screen.getByText('笔迹 1'));
    const input = screen.getByRole('textbox', { name: '重命名 笔迹 1' });
    fireEvent.change(input, { target: { value: '背景' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // 请求在途时先显示乐观值（界面不假装「已保存」）。
    expect(screen.getByText('背景')).toBeTruthy();

    await act(async () => {
      pending.reject(new TypeError('Failed to fetch'));
      await pending.promise.catch(() => undefined);
    });

    await waitFor(() => expect(screen.getByText('笔迹 1')).toBeTruthy());
    expect(screen.queryByText('背景')).toBeNull();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('无法更新图层');
    expect(alert.textContent).toContain('无法连接本地服务');
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy();
    expect(useCanvasStore.getState().canvas?.layers[0]?.name).toBe('笔迹 1');
  });

  it('✎ 按钮可 Tab 聚焦并用 Enter 进入编辑；编辑态方向键与 Delete 不落到行上', () => {
    seedCanvas([makeLayer(1), makeLayer(2)]);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderPanelOnly();

    const rename = screen.getByRole('button', { name: '重命名 笔迹 1' });
    rename.focus();
    expect(document.activeElement).toBe(rename);

    fireEvent.keyDown(rename, { key: 'Enter' });

    const input = screen.getByRole('textbox', { name: '重命名 笔迹 1' });
    expect(document.activeElement).toBe(input);

    // 票 08 的行级键盘仍完好：编辑态的按键既不移焦点也不删图层。
    const activeBefore = useCanvasStore.getState().activeLayerId;
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Delete' });

    expect(document.activeElement).toBe(input);
    expect(screen.getAllByRole('option')).toHaveLength(2);
    expect(useCanvasStore.getState().activeLayerId).toBe(activeBefore);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('图层透明度', () => {
  it('拖动只做本地预览（fetch 0 次），松手 change 才发一次 PATCH', async () => {
    const layers = [makeLayer(1), makeLayer(2)];
    seedCanvas(layers);
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse(
        makeCanvas([{ ...layers[0]!, opacity: 0.4 }, layers[1]!], 2),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderPanelAndCanvas();

    await waitFor(() => expect(fabricCanvas().objects).toHaveLength(2));
    const object = objectFor('layer-1');
    expect(object.opacity).toBe(1);

    const slider = openOpacityFor(0);

    // 拖动过程：Fabric 对象实时变化，网络 0 次。
    fireEvent.input(slider, { target: { value: '30' } });
    fireEvent.input(slider, { target: { value: '40' } });

    expect(object.opacity).toBe(0.4);
    expect(fetchMock).not.toHaveBeenCalled();

    // 松手（原生 change）才提交，且只提交最终值。
    fireEvent.change(slider);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/paint/canvas/canvas-1/layers/layer-1');
    expect(init?.method).toBe('PATCH');
    // 不含 zIndex：协议不支持，本票也不碰。
    expect(JSON.parse(String(init?.body))).toEqual({
      opacity: 0.4,
      expectedRevision: 1,
    });
    expect(useCanvasStore.getState().canvas?.revision).toBe(2);
    expect(useCanvasStore.getState().canvas?.layers[0]?.opacity).toBe(0.4);
  });

  it('透明度 40% 后撤销一次回到拖动前的值（revision 与 opacity）', async () => {
    const original = [makeLayer(1)];
    seedCanvas(original);
    const afterOpacity = makeCanvas([{ ...original[0]!, opacity: 0.4 }], 2);
    const afterUndo = makeCanvas(original, 3);
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        return jsonResponse(afterOpacity);
      }

      if (url.endsWith('/undo')) {
        return jsonResponse(afterUndo);
      }

      throw new Error(`未预期的请求：${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPanelAndCanvas();

    await waitFor(() => expect(fabricCanvas().objects).toHaveLength(1));
    const object = objectFor('layer-1');

    const slider = openOpacityFor(0);
    fireEvent.input(slider, { target: { value: '40' } });
    fireEvent.change(slider);

    await waitFor(() =>
      expect(useCanvasStore.getState().canvas?.revision).toBe(2),
    );
    expect(useCanvasStore.getState().canvas?.layers[0]?.opacity).toBe(0.4);

    await act(async () => {
      await useCanvasStore.getState().undo();
    });

    // 一次拖动只写了一个快照，因此一次撤销就回到 100%。
    expect(useCanvasStore.getState().canvas?.revision).toBe(3);
    expect(useCanvasStore.getState().canvas?.layers[0]?.opacity).toBe(1);
    await waitFor(() => expect(object.opacity).toBe(1));

    const patches = fetchMock.mock.calls.filter(
      ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH',
    );
    expect(patches).toHaveLength(1);
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).endsWith('/undo')),
    ).toBe(true);
  });

  it('透明度提交失败：预览与滑块回到快照值，横幅给出原因', async () => {
    seedCanvas([makeLayer(1)]);
    const fetchMock = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPanelAndCanvas();

    await waitFor(() => expect(fabricCanvas().objects).toHaveLength(1));
    const object = objectFor('layer-1');

    const slider = openOpacityFor(0);
    fireEvent.input(slider, { target: { value: '40' } });
    expect(object.opacity).toBe(0.4);

    fireEvent.change(slider);

    await waitFor(() => expect(object.opacity).toBe(1));
    expect(useCanvasStore.getState().canvas?.layers[0]?.opacity).toBe(1);
    expect((slider as HTMLInputElement).value).toBe('100');
    expect((await screen.findByRole('alert')).textContent).toContain(
      '无法更新图层',
    );
  });
});

describe('新增控件的尺寸契约', () => {
  it('重命名与不透明度按钮命中区 ≥24×24，行高仍是 36–40px', () => {
    const row = ruleBody(layerPanelCss, '.layer-item');
    expect(pxProperty(row, ['height', 'min-height'])).toBeGreaterThanOrEqual(36);
    expect(pxProperty(row, ['height', 'min-height'])).toBeLessThanOrEqual(40);

    const rename = ruleBody(layerPanelCss, '.layer-item__rename');
    expect(pxProperty(rename, ['width', 'min-width'])).toBeGreaterThanOrEqual(24);
    expect(
      pxProperty(rename, ['height', 'min-height']),
    ).toBeGreaterThanOrEqual(24);

    const opacity = ruleBody(layerPanelCss, '.layer-item__opacity');
    expect(
      pxProperty(opacity, ['width', 'min-width']),
    ).toBeGreaterThanOrEqual(24);
    expect(
      pxProperty(opacity, ['height', 'min-height']),
    ).toBeGreaterThanOrEqual(24);

    // 新控件也有焦点环，键盘用户能看见自己停在哪。
    expect(layerPanelCss).toMatch(
      /\.layer-item__rename:focus-visible[^{]*\{[^}]*outline:\s*2px/,
    );
    expect(layerPanelCss).toMatch(
      /\.layer-item__opacity:focus-visible[^{]*\{[^}]*outline:\s*2px/,
    );
  });
});

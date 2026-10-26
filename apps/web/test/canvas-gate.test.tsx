// @vitest-environment jsdom
import type { CanvasDocument } from '@paintcodex/protocol';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CanvasStage } from '../src/features/canvas/CanvasStage';
import { LayerPanel } from '../src/features/layer-panel/LayerPanel';
import { Toolbox } from '../src/features/toolbox/Toolbox';
import { useCanvasStore } from '../src/services/canvas-store';

// The gate never mounts Fabric, but the ready state does. Keep the canvas
// implementation out of jsdom so these tests stay about the gate itself.
vi.mock('fabric', () => {
  class MockCanvas {
    isDrawingMode = false;
    selection = true;
    freeDrawingBrush: unknown = null;

    on() {}
    off() {}
    add() {}
    remove() {}
    requestRenderAll() {}
    discardActiveObject() {}
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

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  useCanvasStore.setState({
    canvas: null,
    status: 'idle',
    error: null,
    requestedCanvasId: null,
    saving: false,
    activeLayerId: null,
  });
  window.localStorage.clear();
  window.history.replaceState({}, '', '/');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('CanvasStage 无画布门禁', () => {
  it('不渲染可交互白画布，点击画布区不发出任何请求', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(<CanvasStage />);

    expect(container.querySelector('canvas')).toBeNull();
    expect(container.querySelector('.canvas-frame')).toBeNull();
    expect(screen.getByRole('button', { name: '开始一张画布' })).toBeTruthy();

    fireEvent.click(container.querySelector('.canvas-gate') as Element);
    fireEvent.click(screen.getByText('还没有画布'));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('空状态只有一个主 CTA', () => {
    const { container } = render(<CanvasStage />);

    expect(container.querySelectorAll('button')).toHaveLength(1);
    expect(screen.getByRole('button', { name: '开始一张画布' })).toBeTruthy();
  });

  it('主 CTA 可聚焦并用 Enter 新建画布', async () => {
    const fetchMock = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) =>
        jsonResponse(canvasDocument()),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<CanvasStage />);

    const cta = screen.getByRole('button', { name: '开始一张画布' });
    cta.focus();
    expect(document.activeElement).toBe(cta);

    fireEvent.keyDown(cta, { key: 'Enter' });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/paint/canvas');
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('POST');
  });

  it('主 CTA 可用 Space 新建画布', async () => {
    const fetchMock = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) =>
        jsonResponse(canvasDocument()),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<CanvasStage />);

    fireEvent.keyDown(screen.getByRole('button', { name: '开始一张画布' }), {
      key: ' ',
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });
});

describe('CanvasStage 加载中', () => {
  it('显示加载文案，不渲染画布', () => {
    useCanvasStore.setState({ status: 'loading' });
    const { container } = render(<CanvasStage />);

    expect(screen.getByText('正在加载画布…')).toBeTruthy();
    expect(container.querySelector('canvas')).toBeNull();
  });
});

describe('CanvasStage 加载失败', () => {
  it('显示中文原因与「重试」「新建画布」，重试发出一次 GET 并恢复就绪', async () => {
    const document = canvasDocument();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonResponse(document));
    vi.stubGlobal('fetch', fetchMock);

    await act(async () => {
      await useCanvasStore.getState().loadCanvas('canvas-1');
    });

    const { container } = render(<CanvasStage />);

    expect(container.querySelector('canvas')).toBeNull();
    expect(screen.getByText('画布加载失败')).toBeTruthy();
    expect(screen.getByText(/无法连接本地服务/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '新建画布' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '重试' }));

    await waitFor(() => expect(container.querySelector('canvas')).toBeTruthy());
    // The canvas name/size live only in the menu bar and status bar now.
    expect(container.querySelector('.canvas-hint')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const retryCall = fetchMock.mock.calls[1]!;
    expect(retryCall[0]).toBe('/paint/canvas/canvas-1');
    expect((retryCall[1] as RequestInit | undefined)?.method ?? 'GET').toBe('GET');
  });
});

describe('LayerPanel 空态', () => {
  it('无画布时显示「还没有画布」', () => {
    render(<LayerPanel />);

    expect(screen.getByText('还没有画布')).toBeTruthy();
  });
});

describe('Toolbox 无画布门禁', () => {
  it('无画布时画笔与选择都禁用', () => {
    render(<Toolbox />);

    expect(
      (screen.getByRole('button', { name: '画笔' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: '选择' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

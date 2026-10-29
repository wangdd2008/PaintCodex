// @vitest-environment jsdom
import type { CanvasDocument, CanvasSummary, Layer } from '@paintcodex/protocol';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/App';
import { useCanvasStore } from '../src/services/canvas-store';

vi.mock('../src/features/canvas/CanvasStage', () => ({
  CanvasStage: () => null,
}));

vi.mock('../src/runtime/paint-sse', () => ({
  subscribeToCanvas: () => () => undefined,
}));

const STORAGE_KEY = 'paintcodex.canvasId';

function layer(id: string, name: string): Layer {
  return {
    id,
    canvasId: 'canvas-a',
    name,
    type: 'vector',
    zIndex: 0,
    visible: true,
    opacity: 1,
    content: { kind: 'fabric', json: `{"type":"path","id":"${id}"}` },
    metadata: { createdBy: 'user', createdAt: 0 },
    createdAt: 0,
  };
}

function canvasDocument(overrides: Partial<CanvasDocument> = {}): CanvasDocument {
  return {
    id: 'canvas-a',
    name: '红色练习',
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

function summary(id: string, name: string): CanvasSummary {
  return {
    id,
    name,
    width: 1920,
    height: 1080,
    backgroundColor: '#ffffff',
    layerCount: 2,
    revision: 1,
    hasThumbnail: false,
    thumbnailRevision: null,
    createdAt: 0,
    updatedAt: Date.now() - 60_000,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    json: async () => body,
  } as unknown as Response;
}

const docA = canvasDocument({
  layers: [layer('layer-1', '笔迹 1'), layer('layer-2', '笔迹 2')],
});
const docB = canvasDocument({ id: 'canvas-b', name: '夜景', revision: 0 });

beforeEach(() => {
  useCanvasStore.setState({
    canvas: docA,
    status: 'ready',
    error: null,
    requestedCanvasId: docA.id,
    previousCanvasId: null,
    saving: false,
    activeLayerId: null,
  });
  Object.defineProperty(Element.prototype, 'scrollTo', {
    configurable: true,
    value: () => undefined,
  });
  window.localStorage.clear();
  window.localStorage.setItem(STORAGE_KEY, 'canvas-a');
  window.history.replaceState({}, '', '/?canvasId=canvas-a');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.history.replaceState({}, '', '/');
});

describe('画布库路由历史', () => {
  it('从库点卡片进入画布 pushState；浏览器后退回到库', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.startsWith('/paint/canvas?')) {
        return jsonResponse({
          items: [summary('canvas-a', '红色练习'), summary('canvas-b', '夜景')],
          total: 2,
          limit: 50,
          offset: 0,
        });
      }

      if (url === '/paint/canvas/canvas-a') {
        return jsonResponse(docA);
      }

      if (url === '/paint/canvas/canvas-b') {
        return jsonResponse(docB);
      }

      return jsonResponse({}, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(createElement(App));
    await waitFor(() => expect(useCanvasStore.getState().status).toBe('ready'));

    // 菜单栏入口进库。
    fireEvent.click(screen.getByRole('button', { name: '画布库' }));

    const cardB = await screen.findByRole('link', { name: /夜景/ });
    // 进入库后地址栏是 page=canvases。
    expect(window.location.search).toContain('page=canvases');

    // 点卡片打开 b：地址栏换成带 id 的画布 URL，画布切换到 b。
    fireEvent.click(cardB);
    await waitFor(() => expect(useCanvasStore.getState().canvas?.id).toBe('canvas-b'));
    expect(window.location.search).toContain('canvasId=canvas-b');
    expect(window.location.search).not.toContain('page=canvases');

    // 浏览器后退：落回库视图，而不是把用户送出应用。
    await act(async () => {
      window.history.back();
    });

    await screen.findByRole('link', { name: /夜景/ });
    expect(window.location.search).toContain('page=canvases');
    expect(window.location.search).not.toContain('canvasId=canvas-b');
  });

  it('popstate 落在画布视图且 id 与当前不同时重新 loadCanvas', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/paint/canvas?')) {
        return jsonResponse({
          items: [summary('canvas-a', '红色练习'), summary('canvas-b', '夜景')],
          total: 2,
          limit: 50,
          offset: 0,
        });
      }
      if (url === '/paint/canvas/canvas-a') return jsonResponse(docA);
      if (url === '/paint/canvas/canvas-b') return jsonResponse(docB);
      return jsonResponse({}, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(createElement(App));
    await waitFor(() => expect(useCanvasStore.getState().status).toBe('ready'));

    // 直接造一条历史：画布 a → 库 → 画布 b，然后后退一步到库，再前进回 b。
    fireEvent.click(screen.getByRole('button', { name: '画布库' }));
    await screen.findByRole('link', { name: /夜景/ });
    fireEvent.click(screen.getByRole('link', { name: /夜景/ }));
    await waitFor(() => expect(useCanvasStore.getState().canvas?.id).toBe('canvas-b'));

    await act(async () => {
      window.history.back();
    });
    await screen.findByRole('link', { name: /夜景/ });

    // 前进：popstate 落回画布视图。回库不卸载活动画布，id 相同故不重复加载。
    await act(async () => {
      window.history.forward();
    });
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: /夜景/ })).toBeNull(),
    );
    expect(useCanvasStore.getState().canvas?.id).toBe('canvas-b');
    expect(window.location.search).toContain('canvasId=canvas-b');
  });
});

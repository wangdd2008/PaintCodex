// @vitest-environment jsdom
import type { CanvasDocument, Layer } from '@paintcodex/protocol';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/App';
import { CanvasNameEditor } from '../src/features/canvas/CanvasNameEditor';
import { useCanvasStore } from '../src/services/canvas-store';
import { canvasPngFilename } from '../src/services/png-export';

// 画布本身（Fabric）与 SSE 属于外壳之外的运行时；本文件只钉画布身份的行为。
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

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    json: async () => body,
  } as unknown as Response;
}

const storedCanvasA = canvasDocument({
  name: '红色练习',
  layers: [layer('layer-1', '笔迹 1'), layer('layer-2', '笔迹 2')],
});

const storedCanvasB = canvasDocument({
  id: 'canvas-b',
  name: '未命名 2026-10-27 00:30',
  revision: 0,
  layers: [],
  history: { canUndo: false, canRedo: false },
});

beforeEach(() => {
  useCanvasStore.setState({
    canvas: storedCanvasA,
    status: 'ready',
    error: null,
    requestedCanvasId: storedCanvasA.id,
    previousCanvasId: null,
    saving: false,
    activeLayerId: null,
  });
  // jsdom 不实现滚动。
  Object.defineProperty(Element.prototype, 'scrollTo', {
    configurable: true,
    value: () => undefined,
  });
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
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

describe('新建画布确认', () => {
  it('有画布时先确认，取消后 URL、localStorage 与当前画布都不变', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input) === '/paint/canvas/canvas-a'
        ? jsonResponse(storedCanvasA)
        : jsonResponse({}, 500),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(createElement(App));

    // 先等首次加载结束，避免把它误算成「新建」请求。
    await waitFor(() => expect(useCanvasStore.getState().status).toBe('ready'));
    fetchMock.mockClear();

    fireEvent.click(screen.getByRole('button', { name: '新建画布' }));

    const dialog = screen.getByRole('alertdialog');
    expect(dialog.textContent).toContain('红色练习');
    expect(screen.getByRole('button', { name: '取消' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(window.location.search).toBe('?canvasId=canvas-a');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('canvas-a');
    expect(useCanvasStore.getState().canvas?.id).toBe('canvas-a');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('确认后新建，并可一次点击「返回上一张」回到原画布（图层完整）', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url === '/paint/canvas' && init?.method === 'POST') {
        return jsonResponse(storedCanvasB, 201);
      }

      if (url === '/paint/canvas/canvas-b') {
        return jsonResponse(storedCanvasB);
      }

      return jsonResponse(storedCanvasA);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(createElement(App));
    await waitFor(() => expect(useCanvasStore.getState().status).toBe('ready'));

    fireEvent.click(screen.getByRole('button', { name: '新建画布' }));
    fireEvent.click(screen.getByRole('button', { name: '新建并切换' }));

    await waitFor(() => expect(useCanvasStore.getState().canvas?.id).toBe('canvas-b'));
    expect(useCanvasStore.getState().previousCanvasId).toBe('canvas-a');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('canvas-b');
    expect(window.location.search).toBe('?canvasId=canvas-b');

    const back = screen.getByRole('button', { name: '返回上一张' });
    const backSpy = vi.spyOn(window.history, 'back');
    fireEvent.click(back);

    await waitFor(() => expect(useCanvasStore.getState().canvas?.id).toBe('canvas-a'));

    // 返回上一张走 previousCanvasId + replaceState，不调用 history.back()，
    // 因此不会把用户送出应用，也不新增历史条目。
    expect(backSpy).not.toHaveBeenCalled();
    backSpy.mockRestore();

    const canvas = useCanvasStore.getState().canvas;
    expect(canvas?.layers).toHaveLength(2);
    expect(canvas?.layers.map((entry) => entry.name)).toEqual(['笔迹 1', '笔迹 2']);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('canvas-a');
    expect(window.location.search).toBe('?canvasId=canvas-a');
    expect(useCanvasStore.getState().previousCanvasId).toBeNull();
    expect(screen.queryByRole('button', { name: '返回上一张' })).toBeNull();
  });

  it('新建失败时当前画布仍可用，URL 与 localStorage 不被覆盖', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/paint/canvas' && init?.method === 'POST') {
        throw new TypeError('Failed to fetch');
      }

      return jsonResponse(storedCanvasA);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(createElement(App));
    await waitFor(() => expect(useCanvasStore.getState().status).toBe('ready'));

    fireEvent.click(screen.getByRole('button', { name: '新建画布' }));
    fireEvent.click(screen.getByRole('button', { name: '新建并切换' }));

    await waitFor(() => expect(useCanvasStore.getState().error).not.toBeNull());

    expect(useCanvasStore.getState().canvas?.id).toBe('canvas-a');
    expect(useCanvasStore.getState().status).toBe('ready');
    expect(window.location.search).toBe('?canvasId=canvas-a');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('canvas-a');
  });
});

describe('画布行内重命名', () => {
  function stubRename(handler: (body: { name?: string }) => Response) {
    return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/paint/canvas/canvas-a' && init?.method === 'PATCH') {
        return handler(JSON.parse(String(init.body)) as { name?: string });
      }

      return jsonResponse(storedCanvasA);
    });
  }

  it('键盘可完成改名：Enter 提交，菜单栏与导出文件名都用新名', async () => {
    const fetchMock = stubRename((body) =>
      jsonResponse({ ...storedCanvasA, name: body.name }),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(createElement(App));
    await waitFor(() => expect(useCanvasStore.getState().status).toBe('ready'));

    const editButton = screen.getByRole('button', { name: '重命名画布' });
    editButton.focus();
    expect(document.activeElement).toBe(editButton);

    fireEvent.keyDown(editButton, { key: 'Enter' });

    const input = screen.getByRole('textbox', { name: '画布名称' }) as HTMLInputElement;
    expect(document.activeElement).toBe(input);

    fireEvent.change(input, { target: { value: '  深夜速写  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(useCanvasStore.getState().canvas?.name).toBe('深夜速写'));

    expect(screen.getByText('深夜速写')).toBeTruthy();
    expect(
      canvasPngFilename(
        useCanvasStore.getState().canvas?.name,
        useCanvasStore.getState().canvas?.id,
      ),
    ).toBe('深夜速写-canvas-a.png');

    const patchCall = fetchMock.mock.calls.find(
      (call) => (call[1] as RequestInit | undefined)?.method === 'PATCH',
    );
    expect(patchCall?.[0]).toBe('/paint/canvas/canvas-a');
    expect(JSON.parse(String((patchCall?.[1] as RequestInit).body))).toEqual({
      name: '深夜速写',
    });
  });

  it('Esc 取消：不产生 PATCH，名称不变', async () => {
    const fetchMock = stubRename((body) =>
      jsonResponse({ ...storedCanvasA, name: body.name }),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(createElement(CanvasNameEditor));

    fireEvent.doubleClick(screen.getByText('红色练习'));

    const input = screen.getByRole('textbox', { name: '画布名称' });
    fireEvent.change(input, { target: { value: '不会提交' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(screen.queryByRole('textbox', { name: '画布名称' })).toBeNull();
    expect(screen.getByText('红色练习')).toBeTruthy();

    // Esc 之后可能还有 blur，等一个微任务再断言没有任何 PATCH。
    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(useCanvasStore.getState().canvas?.name).toBe('红色练习');
  });

  it('失焦提交；空值回退原名且不发请求', async () => {
    const fetchMock = stubRename((body) =>
      jsonResponse({ ...storedCanvasA, name: body.name }),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(createElement(CanvasNameEditor));

    fireEvent.click(screen.getByRole('button', { name: '重命名画布' }));
    const input = screen.getByRole('textbox', { name: '画布名称' });
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.blur(input);

    expect(screen.getByText('红色练习')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '重命名画布' }));
    const reopened = screen.getByRole('textbox', { name: '画布名称' });
    fireEvent.change(reopened, { target: { value: '黄昏练习' } });
    fireEvent.blur(reopened);

    await waitFor(() => expect(useCanvasStore.getState().canvas?.name).toBe('黄昏练习'));
  });

  it('改名失败：名称回滚原名并就地提示', async () => {
    const fetchMock = stubRename(() =>
      jsonResponse(
        { error: { code: 'invalid_canvas', message: '画布名称不能超过 80 个字符' } },
        400,
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(createElement(CanvasNameEditor));

    fireEvent.click(screen.getByRole('button', { name: '重命名画布' }));
    const input = screen.getByRole('textbox', { name: '画布名称' });
    fireEvent.change(input, { target: { value: '太长太长的名字' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        '画布名称不能超过 80 个字符',
      ),
    );

    expect(screen.getByText('红色练习')).toBeTruthy();
    expect(useCanvasStore.getState().canvas?.name).toBe('红色练习');

    // 失败后再次进入编辑：提示清掉，输入框里是原名。
    fireEvent.click(screen.getByRole('button', { name: '重命名画布' }));
    const reopened = screen.getByRole('textbox', { name: '画布名称' }) as HTMLInputElement;
    expect(reopened.value).toBe('红色练习');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

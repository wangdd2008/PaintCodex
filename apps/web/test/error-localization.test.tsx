// @vitest-environment jsdom
import type { CanvasDocument } from '@paintcodex/protocol';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/App';
import { CanvasNameEditor } from '../src/features/canvas/CanvasNameEditor';
import {
  describeCanvasError,
  useCanvasStore,
} from '../src/services/canvas-store';
import { NETWORK_FAILURE_MESSAGE } from '../src/services/network-error';

// App 的画布与实时通道不在本文件范围内：只钉用户可见的错误文案。
vi.mock('../src/features/canvas/CanvasStage', () => ({
  CanvasStage: () => null,
}));
vi.mock('../src/features/ai-chat/AiChatPanel', () => ({
  AiChatPanel: () => null,
}));
vi.mock('../src/runtime/paint-sse', () => ({
  subscribeToCanvas: () => () => undefined,
}));

const STORAGE_KEY = 'paintcodex.canvasId';

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

function resetStore(): void {
  useCanvasStore.setState({
    canvas: null,
    status: 'idle',
    error: null,
    requestedCanvasId: null,
    previousCanvasId: null,
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
}

beforeEach(() => {
  resetStore();
  window.localStorage.clear();
  window.history.replaceState({}, '', '/');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetStore();
  window.localStorage.clear();
  window.history.replaceState({}, '', '/');
});

describe('错误文案中文化', () => {
  it('网络失败折成统一中文，未知英文错误落回调用点兜底', () => {
    expect(describeCanvasError(new TypeError('Failed to fetch'), '无法加载画布')).toBe(
      NETWORK_FAILURE_MESSAGE,
    );
    expect(describeCanvasError(new Error('boom'), '无法加载画布')).toBe(
      '无法加载画布',
    );
    // daemon 已经给出的中文原样保留。
    expect(describeCanvasError(new Error('画布名称不能超过 80 个字符'), '兜底')).toBe(
      '画布名称不能超过 80 个字符',
    );
  });

  it('改名失败提示是中文，不含 Failed to fetch', async () => {
    useCanvasStore.setState({
      canvas: canvasDocument(),
      status: 'ready',
      requestedCanvasId: 'canvas-a',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    );

    render(<CanvasNameEditor />);

    fireEvent.click(screen.getByRole('button', { name: '重命名画布' }));
    const input = screen.getByRole('textbox', { name: '画布名称' });
    fireEvent.change(input, { target: { value: '深夜速写' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(NETWORK_FAILURE_MESSAGE);
    expect(alert.textContent).not.toContain('Failed to fetch');
    expect(useCanvasStore.getState().canvas?.name).toBe('红色练习');
  });

  it('加载失败时菜单栏摘要也是中文，不含 Failed to fetch', async () => {
    window.localStorage.setItem(STORAGE_KEY, 'canvas-a');
    window.history.replaceState({}, '', '/?canvasId=canvas-a');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    );

    const { container } = render(<App />);

    await waitFor(() =>
      expect(useCanvasStore.getState().error).toBe(NETWORK_FAILURE_MESSAGE),
    );

    const menuStatus = container.querySelector('.menu-status');
    expect(menuStatus?.textContent).toBe(NETWORK_FAILURE_MESSAGE);
    expect(menuStatus?.textContent).not.toContain('Failed to fetch');
  });

  it('daemon 返回的中文错误原样显示', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(
          { error: { code: 'canvas_not_found', message: '画布不存在' } },
          404,
        ),
      ),
    );

    await act(async () => {
      await useCanvasStore.getState().loadCanvas('canvas-a');
    });

    expect(useCanvasStore.getState().status).toBe('error');
    expect(useCanvasStore.getState().error).toBe('画布不存在');
    expect(useCanvasStore.getState().error).not.toContain('Failed to fetch');
  });
});

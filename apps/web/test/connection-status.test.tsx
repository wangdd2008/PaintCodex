// @vitest-environment jsdom
import type { CanvasDocument } from '@paintcodex/protocol';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/App';
import { useCanvasStore } from '../src/services/canvas-store';
import { useViewportStore } from '../src/services/viewport-store';

interface SubscribedHandlers {
  onOpen?: () => void;
  onSnapshotChanged?: (event: { canvasId: string; revision: number }) => void;
  onError?: () => void;
}

const { sse, refreshSpy } = vi.hoisted(() => ({
  sse: {
    handlers: null as SubscribedHandlers | null,
    canvasIds: [] as string[],
    unsubscribe: vi.fn(),
  },
  refreshSpy: vi.fn(async () => undefined),
}));

// 只保留订阅契约：测试直接触发 open/error，验证 App 对连接状态的反应。
vi.mock('../src/runtime/paint-sse', () => ({
  subscribeToCanvas: (canvasId: string, handlers: SubscribedHandlers) => {
    sse.handlers = handlers;
    sse.canvasIds.push(canvasId);
    return sse.unsubscribe;
  },
}));

vi.mock('../src/features/canvas/CanvasStage', () => ({
  CanvasStage: () => null,
}));
vi.mock('../src/features/ai-chat/AiChatPanel', () => ({
  AiChatPanel: () => null,
}));

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

function resetStores(): void {
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
    refreshCanvas: async () => undefined,
  });
  useViewportStore.setState({ zoomPercent: null });
}

function renderReadyCanvas(): void {
  useCanvasStore.setState({
    canvas: canvasDocument(),
    status: 'ready',
    refreshCanvas: refreshSpy,
  });
  render(<App />);
}

function connectionIndicator(): HTMLElement {
  return screen.getByRole('status');
}

beforeEach(() => {
  resetStores();
  refreshSpy.mockClear();
  sse.handlers = null;
  sse.canvasIds = [];
  sse.unsubscribe.mockClear();
  window.localStorage.clear();
  window.history.replaceState({}, '', '/');
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('画布连接状态', () => {
  it('渲染后先显示「连接中…」，open 后变「实时中」且只刷新一次', async () => {
    vi.useFakeTimers();
    renderReadyCanvas();

    // 打开画布时先连接中；圆点对读屏隐藏，状态只由外层 role="status" 播报。
    const indicator = connectionIndicator();
    expect(indicator.textContent).toBe('连接中…');
    expect(indicator.className).toContain('status-bar__connection--connecting');
    expect(
      indicator.querySelector('.status-bar__connection-dot')?.getAttribute('aria-hidden'),
    ).toBe('true');
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(refreshSpy).not.toHaveBeenCalled();

    await act(async () => {
      sse.handlers?.onOpen?.();
    });

    expect(connectionIndicator().textContent).toBe('实时中');
    expect(connectionIndicator().className).toContain('status-bar__connection--live');
    expect(refreshSpy).toHaveBeenCalledTimes(1);

    // 不新增轮询：快进 60 秒仍然只有 open 时那一次刷新。
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(refreshSpy).toHaveBeenCalledTimes(1);
  });

  it('error 后显示琥珀色的「重新连接中…」，不出现红色错误横幅', async () => {
    renderReadyCanvas();

    await act(async () => {
      sse.handlers?.onOpen?.();
    });
    expect(connectionIndicator().textContent).toBe('实时中');

    act(() => {
      sse.handlers?.onError?.();
    });

    const indicator = connectionIndicator();
    expect(indicator.textContent).toBe('重新连接中…');
    expect(indicator.className).toContain('status-bar__connection--reconnecting');
    // 同一状态重复上报（EventSource 会多次 error）不新增播报节点。
    act(() => {
      sse.handlers?.onError?.();
    });
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(connectionIndicator().textContent).toBe('重新连接中…');
    // 画布区的 role="alert" 只承载操作失败，SSE 断线不占用它。
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('恢复后 open 回到「实时中」，并再刷新一次（每次 open 恰好一次）', async () => {
    renderReadyCanvas();

    await act(async () => {
      sse.handlers?.onOpen?.();
    });
    expect(refreshSpy).toHaveBeenCalledTimes(1);

    act(() => {
      sse.handlers?.onError?.();
    });
    expect(connectionIndicator().textContent).toBe('重新连接中…');

    // EventSource 自己重连成功：不点任何按钮，open 再次到达。
    await act(async () => {
      sse.handlers?.onOpen?.();
    });

    expect(connectionIndicator().textContent).toBe('实时中');
    expect(connectionIndicator().className).toContain('status-bar__connection--live');
    expect(refreshSpy).toHaveBeenCalledTimes(2);
  });

  it('切换到另一张画布时回到「连接中…」，并重新订阅', async () => {
    renderReadyCanvas();

    await act(async () => {
      sse.handlers?.onOpen?.();
    });
    expect(connectionIndicator().textContent).toBe('实时中');
    expect(sse.canvasIds).toEqual(['canvas-1']);

    act(() => {
      useCanvasStore.setState({ canvas: canvasDocument({ id: 'canvas-2' }) });
    });

    expect(connectionIndicator().textContent).toBe('连接中…');
    expect(connectionIndicator().className).toContain('status-bar__connection--connecting');
    expect(sse.canvasIds).toEqual(['canvas-1', 'canvas-2']);

    await act(async () => {
      sse.handlers?.onOpen?.();
    });
    expect(connectionIndicator().textContent).toBe('实时中');
  });

  it('没有画布时不渲染连接槽位，不伪造连接状态', () => {
    render(<App />);

    expect(screen.queryByRole('status')).toBeNull();
    expect(document.querySelector('.status-bar__connection')).toBeNull();
    // 状态栏本身仍在，保存状态等槽位不受影响。
    expect(document.querySelector('.status-bar')?.textContent).toContain('无画布');
  });
});

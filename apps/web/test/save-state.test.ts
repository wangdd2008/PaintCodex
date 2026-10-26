// @vitest-environment jsdom
import type { CanvasDocument, Layer } from '@paintcodex/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SAVE_DEBOUNCE_MS,
  useCanvasStore,
  type SaveState,
} from '../src/services/canvas-store';

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

beforeEach(() => {
  vi.useFakeTimers();
  resetStore();
  window.localStorage.clear();
  window.history.replaceState({}, '', '/');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('保存状态机', () => {
  it('连续 5 笔只出现一次「保存中 → 已保存」', async () => {
    const layers: Layer[] = [];
    let revision = 1;

    const fetchMock = vi.fn(
      async (_url: RequestInfo | URL, init?: RequestInit) => {
        revision += 1;
        const body = JSON.parse(String(init?.body)) as {
          name: string;
          type: Layer['type'];
          content: Layer['content'];
        };

        layers.push({
          id: `layer-${revision}`,
          canvasId: 'canvas-1',
          name: body.name,
          type: body.type,
          zIndex: layers.length,
          visible: true,
          opacity: 1,
          content: body.content,
          metadata: { createdBy: 'user', createdAt: 0 },
          createdAt: 0,
        });

        return jsonResponse(
          canvasDocument({ revision, layers: layers.map((layer) => ({ ...layer })) }),
        );
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    useCanvasStore.setState({ canvas: canvasDocument(), status: 'ready' });

    const transitions: SaveState[] = [];
    const unsubscribe = useCanvasStore.subscribe((state, previous) => {
      if (state.saveState !== previous.saveState) {
        transitions.push(state.saveState);
      }
    });

    const mutations = Array.from({ length: 5 }, (_, index) =>
      useCanvasStore.getState().createLayer({
        name: `Stroke ${index + 1}`,
        type: 'vector',
        content: { kind: 'fabric', json: JSON.stringify({ index }) },
      }),
    );

    await Promise.all(mutations);

    expect(transitions).toEqual(['saving']);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(useCanvasStore.getState().canvas?.layers).toHaveLength(5);

    // Debounce: the burst settles once, and never flickers back and forth.
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS - 1);
    expect(transitions).toEqual(['saving']);

    vi.advanceTimersByTime(1);
    expect(transitions).toEqual(['saving', 'saved']);
    expect(useCanvasStore.getState().lastSavedAt).not.toBeNull();
    expect(useCanvasStore.getState().saveState).toBe('saved');

    unsubscribe();
  });

  it('保存失败进入 error，并给出中文原因', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    );
    useCanvasStore.setState({ canvas: canvasDocument(), status: 'ready' });

    await expect(
      useCanvasStore.getState().createLayer({
        name: 'Stroke 1',
        type: 'vector',
        content: { kind: 'fabric', json: '{"type":"path"}' },
      }),
    ).rejects.toBeInstanceOf(TypeError);

    const state = useCanvasStore.getState();
    expect(state.saveState).toBe('error');
    expect(state.saving).toBe(false);
    expect(state.saveError).toContain('无法连接本地服务');
  });

  it('撤销与重做失败把中文原因写进横幅', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    );
    useCanvasStore.setState({
      canvas: canvasDocument({ history: { canUndo: true, canRedo: false } }),
      status: 'ready',
    });

    await useCanvasStore.getState().undo();

    const state = useCanvasStore.getState();
    expect(state.canvasAlert).toContain('无法撤销');
    expect(state.canvasAlert).toContain('无法连接本地服务');
    expect(state.canvasRetry).not.toBeNull();
  });
});

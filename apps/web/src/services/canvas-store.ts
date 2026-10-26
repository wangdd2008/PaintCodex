import { create } from 'zustand';
import type {
  CanvasDocument,
  CreateLayerInput,
  Layer,
  UpdateLayerPatch,
} from '@paintcodex/protocol';
import {
  ApiError,
  createCanvas,
  createLayer as createLayerRequest,
  deleteLayer as deleteLayerRequest,
  getCanvas,
  redoCanvas,
  renameCanvas as renameCanvasRequest,
  undoCanvas,
  updateLayer as updateLayerRequest,
} from './api';
import { isNetworkFailure, NETWORK_FAILURE_MESSAGE } from './network-error';

const STORAGE_KEY = 'paintcodex.canvasId';

/** 连续笔画只结算成一次「已保存」状态（ADR-0008）。 */
export const SAVE_DEBOUNCE_MS = 500;

const CHINESE_PATTERN = /[\u4e00-\u9fff]/;

export type CanvasStatus = 'idle' | 'loading' | 'ready' | 'error';

/** 保存状态只描述持久化，与导出无关（ADR-0008）。 */
export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export type SaveRetry = () => Promise<void> | void;

interface CanvasState {
  canvas: CanvasDocument | null;
  status: CanvasStatus;
  error: string | null;
  /**
   * 界面正在等待的画布 id。`canvas` 为 null 时，用它区分「加载失败」（id 存在）
   * 与「还没有画布」（id 为 null）。
   */
  requestedCanvasId: string | null;
  /**
   * 单级回退指针。新建画布容易误点，而这一轮没有画布列表，记住一个 id
   * 就足以让上一张文档一键返回。
   */
  previousCanvasId: string | null;
  /** 与 `saveState === 'saving'` 保持同步，供既有的禁用逻辑使用。 */
  saving: boolean;
  saveState: SaveState;
  lastSavedAt: number | null;
  /** 最近一次持久化失败的原因（中文）。 */
  saveError: string | null;
  /** 仍在屏幕上的失败笔画；有它就挡掉不诚实的「已保存」。 */
  unsavedStrokes: number;
  /** 同一时刻只显示一条画布级错误横幅（spec §2）。 */
  canvasAlert: string | null;
  /** 重试属于抛出横幅的那次失败 mutation。 */
  canvasRetry: SaveRetry | null;
  activeLayerId: string | null;
  /**
   * 只在用户显式选中（`setActiveLayer`）时递增。画布 mutation 也会设置
   * `activeLayerId`（新笔画成为活动图层），但它们不得重放画布的「定位」反馈。
   */
  activeLayerRequest: number;
  createNewCanvas: () => Promise<void>;
  returnToPreviousCanvas: () => Promise<void>;
  loadCanvas: (id: string) => Promise<void>;
  refreshCanvas: () => Promise<void>;
  renameCanvas: (name: string) => Promise<void>;
  createLayer: (input: CreateLayerInput) => Promise<Layer | null>;
  updateLayer: (layerId: string, patch: UpdateLayerPatch) => Promise<void>;
  /** 解析为删除后的画布（只有成功时行才会消失）。 */
  deleteLayer: (layerId: string) => Promise<CanvasDocument>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  setActiveLayer: (layerId: string | null) => void;
  showCanvasAlert: (message: string, retry?: SaveRetry | null) => void;
  dismissCanvasAlert: () => void;
  retryCanvasAlert: () => Promise<void>;
  setUnsavedStrokes: (count: number) => void;
  markPendingStrokesSaved: () => void;
}

type SetState = (partial: Partial<CanvasState>) => void;
type GetState = () => CanvasState;

interface SaveReset {
  saveState: SaveState;
  lastSavedAt: null;
  saving: false;
  saveError: null;
  unsavedStrokes: 0;
  canvasAlert: null;
  canvasRetry: null;
}

let mutationQueue: Promise<unknown> = Promise.resolve();
let mutationDepth = 0;
let savedTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Serialises canvas mutations so rapid brush strokes always send the revision
 * produced by the previous save.
 */
function enqueueMutation<T>(task: () => Promise<T>): Promise<T> {
  const result = mutationQueue.then(task, task);
  mutationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function cancelSavedTimer(): void {
  if (savedTimer !== null) {
    clearTimeout(savedTimer);
    savedTimer = null;
  }
}

function resetSaveState(): SaveReset {
  cancelSavedTimer();
  mutationDepth = 0;

  return {
    saveState: 'idle',
    lastSavedAt: null,
    saving: false,
    saveError: null,
    unsavedStrokes: 0,
    canvasAlert: null,
    canvasRetry: null,
  };
}

/**
 * 所有用户可见错误都从这里出站：网络失败给统一中文提示，daemon 已经给出的
 * 中文 message 原样保留，其余（含只有英文 message 的运行时错误）落到调用点
 * 的中文兜底，避免 `Failed to fetch` 之类的文案漏到界面上。
 */
export function describeCanvasError(error: unknown, fallback: string): string {
  if (isNetworkFailure(error)) {
    return NETWORK_FAILURE_MESSAGE;
  }

  if (error instanceof ApiError) {
    return CHINESE_PATTERN.test(error.message) ? error.message : fallback;
  }

  if (error instanceof Error && CHINESE_PATTERN.test(error.message)) {
    return error.message;
  }

  return fallback;
}

function beginMutation(set: SetState, get: GetState): void {
  mutationDepth += 1;
  cancelSavedTimer();

  if (get().saveState !== 'saving') {
    set({ saveState: 'saving', saving: true });
  }
}

function finishMutationSuccess(set: SetState, get: GetState): void {
  mutationDepth = Math.max(0, mutationDepth - 1);

  if (mutationDepth > 0) {
    return;
  }

  // 已经没有任何请求在途，控件不能因为展示层的防抖还停在「保存中」而继续禁用。
  if (get().saving) {
    set({ saving: false });
  }

  // 失败的 mutation 保留错误态直到重试成功；失败笔画也保留错误态直到真正保存。
  if (get().unsavedStrokes > 0 || get().saveState === 'error') {
    set({ saveState: 'error', saving: false });
    return;
  }

  cancelSavedTimer();
  savedTimer = setTimeout(() => {
    savedTimer = null;

    const state = get();

    if (mutationDepth > 0) {
      return;
    }

    if (state.unsavedStrokes > 0 || state.saveState === 'error') {
      set({ saveState: 'error', saving: false });
      return;
    }

    set({
      saveState: 'saved',
      saving: false,
      saveError: null,
      lastSavedAt: Date.now(),
    });
  }, SAVE_DEBOUNCE_MS);
}

function finishMutationFailure(
  set: SetState,
  get: GetState,
  message: string,
): void {
  mutationDepth = Math.max(0, mutationDepth - 1);
  cancelSavedTimer();
  set({ saveState: 'error', saving: false, saveError: message });
}

async function runMutation<T>(
  set: SetState,
  get: GetState,
  task: () => Promise<T>,
  fallbackError: string,
): Promise<T> {
  beginMutation(set, get);

  try {
    const result = await enqueueMutation(task);
    finishMutationSuccess(set, get);
    return result;
  } catch (error) {
    finishMutationFailure(set, get, describeCanvasError(error, fallbackError));
    throw error;
  }
}

function rememberCanvas(id: string | null): void {
  const url = new URL(window.location.href);

  if (id) {
    url.searchParams.set('canvasId', id);
    window.localStorage.setItem(STORAGE_KEY, id);
  } else {
    url.searchParams.delete('canvasId');
    window.localStorage.removeItem(STORAGE_KEY);
  }

  window.history.replaceState({}, '', url);
}

export function readRememberedCanvasId(): string | null {
  const fromUrl = new URLSearchParams(window.location.search).get('canvasId');
  return fromUrl ?? window.localStorage.getItem(STORAGE_KEY);
}

function topLayerId(canvas: CanvasDocument): string | null {
  return canvas.layers.length > 0 ? canvas.layers[canvas.layers.length - 1]!.id : null;
}

function mergeActiveLayer(
  canvas: CanvasDocument,
  activeLayerId: string | null,
): string | null {
  return activeLayerId !== null &&
    canvas.layers.some((layer) => layer.id === activeLayerId)
    ? activeLayerId
    : topLayerId(canvas);
}

/**
 * A stroke drawn while another tab saved must not be dropped. Refresh the
 * canvas on a revision conflict and retry once with the authoritative revision.
 */
async function createLayerWithRetry(
  get: GetState,
  set: SetState,
  input: CreateLayerInput,
): Promise<CanvasDocument> {
  let attempt = 0;

  for (;;) {
    const current = get().canvas;

    if (!current) {
      throw new Error('No canvas loaded');
    }

    try {
      return await createLayerRequest(current.id, input, current.revision);
    } catch (error) {
      const canRetry =
        error instanceof ApiError &&
        error.status === 409 &&
        error.code === 'revision_conflict' &&
        attempt === 0;

      if (!canRetry) {
        throw error;
      }

      attempt += 1;
      const fresh = await getCanvas(current.id);
      set({
        canvas: fresh,
        status: 'ready',
        activeLayerId: mergeActiveLayer(fresh, get().activeLayerId),
      });
    }
  }
}

/** 撤销与重做只差服务端调用和失败文案，其余流程完全一致。 */
async function performHistoryStep(
  set: SetState,
  get: GetState,
  step: 'undo' | 'redo',
): Promise<void> {
  const request = step === 'undo' ? undoCanvas : redoCanvas;
  const actionLabel = step === 'undo' ? '无法撤销' : '无法重做';

  await runMutation(
    set,
    get,
    async () => {
      const current = get().canvas;

      if (!current) {
        throw new Error('No canvas loaded');
      }

      const updated = await request(current.id, current.revision);
      set({
        canvas: updated,
        status: 'ready',
        activeLayerId: mergeActiveLayer(updated, get().activeLayerId),
      });
    },
    actionLabel,
  );
}

/** 失败横幅统一成「无法X：原因」，重试复用同一个 mutation。 */
function alertMutationFailure(
  get: GetState,
  actionLabel: string,
  retry: SaveRetry,
): void {
  get().showCanvasAlert(
    `${actionLabel}：${get().saveError ?? '未知原因'}`,
    retry,
  );
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
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

  createNewCanvas: async () => {
    const previous = get().canvas;

    set({ status: 'loading', error: null, ...resetSaveState() });

    try {
      const canvas = await createCanvas();
      // 只有真正存在的画布才能占用地址栏与 localStorage；
      // 在那之前，当前文档必须保持可寻址。
      rememberCanvas(canvas.id);
      set({
        canvas,
        status: 'ready',
        error: null,
        requestedCanvasId: canvas.id,
        previousCanvasId: previous?.id ?? get().previousCanvasId,
        activeLayerId: topLayerId(canvas),
      });
    } catch (error) {
      // 新建失败：当前文档必须继续可用、可寻址。
      set({
        status: previous ? 'ready' : 'error',
        requestedCanvasId: previous?.id ?? null,
        error: describeCanvasError(error, '无法创建画布'),
      });
    }
  },

  returnToPreviousCanvas: async () => {
    const previousId = get().previousCanvasId;
    const current = get().canvas;

    if (!previousId) {
      return;
    }

    // 切换文档会重置上一张的持久化状态。
    set({ status: 'loading', error: null, ...resetSaveState() });

    try {
      const canvas = await getCanvas(previousId);
      rememberCanvas(canvas.id);
      set({
        canvas,
        status: 'ready',
        error: null,
        requestedCanvasId: canvas.id,
        previousCanvasId: null,
        activeLayerId: topLayerId(canvas),
      });
    } catch (error) {
      // 返回失败不能把当前文档一起拖下水。
      const missing = error instanceof ApiError && error.status === 404;
      const message = missing
        ? '上一张画布不存在，可能已被删除。'
        : describeCanvasError(error, '无法返回上一张画布');

      set({
        canvas: current,
        status: current ? 'ready' : 'error',
        requestedCanvasId: current?.id ?? previousId,
        previousCanvasId: missing ? null : previousId,
        error: message,
      });
    }
  },

  renameCanvas: async (name: string) => {
    const current = get().canvas;

    if (!current) {
      throw new Error('没有可重命名的画布');
    }

    // 与笔画共用同一条队列：用旧快照应答的改名，不能落在更新的笔画保存之后，
    // 否则会把刚画的图层藏起来。
    // 保存状态不参与——改名是身份变化，不是内容持久化。
    const updated = await enqueueMutation(() =>
      renameCanvasRequest(current.id, name.trim()),
    );

    // 用户切换画布后才返回的改名结果，不得覆盖屏幕上当前的文档。
    if (get().canvas?.id !== current.id) {
      return;
    }

    set({
      canvas: updated,
      status: 'ready',
      activeLayerId: mergeActiveLayer(updated, get().activeLayerId),
    });
  },

  loadCanvas: async (id: string) => {
    set({ status: 'loading', error: null, requestedCanvasId: id, ...resetSaveState() });

    try {
      const canvas = await getCanvas(id);
      rememberCanvas(canvas.id);
      set({
        canvas,
        status: 'ready',
        error: null,
        requestedCanvasId: canvas.id,
        activeLayerId: topLayerId(canvas),
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        rememberCanvas(null);
      }

      set({
        canvas: null,
        status: 'error',
        error: describeCanvasError(error, '无法加载画布'),
        requestedCanvasId: id,
      });
    }
  },

  refreshCanvas: async () => {
    const current = get().canvas;

    if (!current) {
      return;
    }

    try {
      const updated = await getCanvas(current.id);
      set({
        canvas: updated,
        status: 'ready',
        activeLayerId: mergeActiveLayer(updated, get().activeLayerId),
      });
    } catch (error) {
      // 刷新成功不能清掉横幅：横幅描述的是 mutation，而这里只是一次读取。
      // 刷新失败也只更新摘要错误。
      set({
        error: describeCanvasError(error, '无法刷新画布'),
      });
    }
  },

  createLayer: async (input: CreateLayerInput) => {
    let created: Layer | null = null;

    await runMutation(
      set,
      get,
      async () => {
        const updated = await createLayerWithRetry(get, set, input);
        created = updated.layers[updated.layers.length - 1] ?? null;
        set({
          canvas: updated,
          status: 'ready',
          activeLayerId: created?.id ?? get().activeLayerId,
        });
      },
      '无法保存图层',
    );

    return created;
  },

  updateLayer: async (layerId: string, patch: UpdateLayerPatch) => {
    try {
      await runMutation(
        set,
        get,
        async () => {
          const current = get().canvas;

          if (!current) {
            throw new Error('No canvas loaded');
          }

          const updated = await updateLayerRequest(
            current.id,
            layerId,
            patch,
            current.revision,
          );
          set({ canvas: updated, status: 'ready' });
        },
        '无法更新图层',
      );
    } catch (error) {
      alertMutationFailure(get, '无法更新图层', () =>
        get().updateLayer(layerId, patch),
      );
      throw error;
    }
  },

  deleteLayer: async (layerId: string) => {
    try {
      return await runMutation(
        set,
        get,
        async () => {
          const current = get().canvas;

          if (!current) {
            throw new Error('No canvas loaded');
          }

          const updated = await deleteLayerRequest(current.id, layerId, current.revision);
          set({
            canvas: updated,
            status: 'ready',
            activeLayerId:
              get().activeLayerId === layerId ? topLayerId(updated) : get().activeLayerId,
          });
          return updated;
        },
        '无法删除图层',
      );
    } catch (error) {
      alertMutationFailure(get, '无法删除图层', async () => {
        await get().deleteLayer(layerId);
      });
      throw error;
    }
  },

  undo: async () => {
    try {
      await performHistoryStep(set, get, 'undo');
    } catch {
      alertMutationFailure(get, '无法撤销', () =>
        performHistoryStep(set, get, 'undo'),
      );
    }
  },

  redo: async () => {
    try {
      await performHistoryStep(set, get, 'redo');
    } catch {
      alertMutationFailure(get, '无法重做', () =>
        performHistoryStep(set, get, 'redo'),
      );
    }
  },

  setActiveLayer: (layerId: string | null) => {
    set({
      activeLayerId: layerId,
      activeLayerRequest: get().activeLayerRequest + 1,
    });
  },

  showCanvasAlert: (message: string, retry: SaveRetry | null = null) => {
    set({ canvasAlert: message, canvasRetry: retry });
  },

  dismissCanvasAlert: () => {
    // 保留重试回调，状态栏的「保存失败 · 重试」仍要能用。
    set({ canvasAlert: null });
  },

  retryCanvasAlert: async () => {
    const retry = get().canvasRetry;

    if (!retry) {
      return;
    }

    try {
      await retry();
    } catch {
      return;
    }

    if (get().canvasRetry === retry) {
      set({ canvasAlert: null, canvasRetry: null });
    }
  },

  setUnsavedStrokes: (count: number) => {
    set({ unsavedStrokes: Math.max(0, count) });
  },

  /** 待保存笔画落定后显示「已保存」；仍有未保存笔画时什么都不做。 */
  markPendingStrokesSaved: () => {
    if (get().unsavedStrokes > 0) {
      return;
    }

    cancelSavedTimer();
    set({
      saveState: 'saved',
      saving: false,
      saveError: null,
      lastSavedAt: Date.now(),
    });
  },
}));

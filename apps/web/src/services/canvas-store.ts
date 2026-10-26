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

const STORAGE_KEY = 'paintcodex.canvasId';

/** Consecutive strokes settle into one "saved" transition (ADR-0008). */
export const SAVE_DEBOUNCE_MS = 500;

const NETWORK_ERROR_PATTERN =
  /failed to fetch|networkerror|load failed|network request failed|fetch failed/i;
const CHINESE_PATTERN = /[\u4e00-\u9fff]/;

export type CanvasStatus = 'idle' | 'loading' | 'ready' | 'error';

/** Save state only ever describes persistence, never export (ADR-0008). */
export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export type SaveRetry = () => Promise<void> | void;

interface CanvasState {
  canvas: CanvasDocument | null;
  status: CanvasStatus;
  error: string | null;
  /**
   * The canvas id the UI is waiting for. Distinguishes "load failed" (id exists)
   * from "no canvas yet" (id null) once `canvas` is null in both cases.
   */
  requestedCanvasId: string | null;
  /**
   * Single-level back pointer. Creating a canvas is easy to misclick and there
   * is no canvas list this round, so remembering exactly one id is enough to
   * make the previous document reachable again in one click.
   */
  previousCanvasId: string | null;
  /** Kept in sync with `saveState === 'saving'` for existing disabled logic. */
  saving: boolean;
  saveState: SaveState;
  lastSavedAt: number | null;
  /** Reason of the most recent failed persistence attempt, in Chinese. */
  saveError: string | null;
  /** Failed strokes still on screen; blocks an honest "已保存". */
  unsavedStrokes: number;
  /** One canvas-level error banner at a time (spec §2). */
  canvasAlert: string | null;
  /** Retry belongs to the failed mutation that raised the banner. */
  canvasRetry: SaveRetry | null;
  activeLayerId: string | null;
  /**
   * Increments only on an explicit user selection (`setActiveLayer`). Canvas
   * mutations also set `activeLayerId` (a new stroke becomes the active layer),
   * but those must not replay the canvas "locate" feedback.
   */
  activeLayerRequest: number;
  createNewCanvas: () => Promise<void>;
  returnToPreviousCanvas: () => Promise<void>;
  loadCanvas: (id: string) => Promise<void>;
  refreshCanvas: () => Promise<void>;
  renameCanvas: (name: string) => Promise<void>;
  createLayer: (input: CreateLayerInput) => Promise<Layer | null>;
  updateLayer: (layerId: string, patch: UpdateLayerPatch) => Promise<void>;
  deleteLayer: (layerId: string) => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  setActiveLayer: (layerId: string | null) => void;
  showCanvasAlert: (message: string, retry?: SaveRetry | null) => void;
  dismissCanvasAlert: () => void;
  retryCanvasAlert: () => Promise<void>;
  setUnsavedStrokes: (count: number) => void;
  markStrokesPersisted: () => void;
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

/** Transport failures become a Chinese, actionable reason; daemon text is kept. */
function describeSaveFailure(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    return error.message;
  }

  if (error instanceof Error) {
    if (NETWORK_ERROR_PATTERN.test(error.message)) {
      return '无法连接本地服务，请确认服务已启动后重试。';
    }

    if (CHINESE_PATTERN.test(error.message)) {
      return error.message;
    }
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

  // Nothing is in flight any more, so controls must not stay disabled while the
  // display debounce keeps showing "保存中" for up to SAVE_DEBOUNCE_MS.
  if (get().saving) {
    set({ saving: false });
  }

  // A failed mutation keeps the state honest until it is retried, and failed
  // strokes keep it honest until they are persisted.
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

async function runMutation(
  set: SetState,
  get: GetState,
  task: () => Promise<void>,
  fallbackError: string,
): Promise<void> {
  beginMutation(set, get);

  try {
    await enqueueMutation(task);
    finishMutationSuccess(set, get);
  } catch (error) {
    finishMutationFailure(set, get, describeSaveFailure(error, fallbackError));
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

async function performUndo(set: SetState, get: GetState): Promise<void> {
  await runMutation(
    set,
    get,
    async () => {
      const current = get().canvas;

      if (!current) {
        throw new Error('No canvas loaded');
      }

      const updated = await undoCanvas(current.id, current.revision);
      set({
        canvas: updated,
        status: 'ready',
        activeLayerId: mergeActiveLayer(updated, get().activeLayerId),
      });
    },
    '无法撤销',
  );
}

async function performRedo(set: SetState, get: GetState): Promise<void> {
  await runMutation(
    set,
    get,
    async () => {
      const current = get().canvas;

      if (!current) {
        throw new Error('No canvas loaded');
      }

      const updated = await redoCanvas(current.id, current.revision);
      set({
        canvas: updated,
        status: 'ready',
        activeLayerId: mergeActiveLayer(updated, get().activeLayerId),
      });
    },
    '无法重做',
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
      // Only a canvas that actually exists may claim the address bar and
      // localStorage; until then the current document stays addressable.
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
      // Creation failed: the current document must stay usable and addressable.
      set({
        status: previous ? 'ready' : 'error',
        requestedCanvasId: previous?.id ?? null,
        error: error instanceof Error ? error.message : '无法创建画布',
      });
    }
  },

  returnToPreviousCanvas: async () => {
    const previousId = get().previousCanvasId;
    const current = get().canvas;

    if (!previousId) {
      return;
    }

    // Switching documents resets the persisted-status of the old one.
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
      // A failed return must not take the current document down with it.
      const missing = error instanceof ApiError && error.status === 404;
      let message = '无法返回上一张画布';

      if (error instanceof Error) {
        message = error.message;
      }

      if (missing) {
        message = '上一张画布不存在，可能已被删除。';
      }

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

    // Same queue as strokes: a rename answered with an older snapshot must not
    // land after a newer stroke save and hide the layer that was just drawn.
    // Save state is left alone — a rename is identity, not persistence of content.
    const updated = await enqueueMutation(() =>
      renameCanvasRequest(current.id, name.trim()),
    );

    // A rename answered after the user switched canvases must not overwrite
    // the document that is on screen now.
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
        error: error instanceof Error ? error.message : '无法加载画布',
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
      // A successful refresh must not clear the banner: the banner describes a
      // mutation, while this is only a read. A failed one only sets the summary.
      set({
        error: error instanceof Error ? error.message : '无法刷新画布',
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
      get().showCanvasAlert(`无法更新图层：${get().saveError ?? '未知原因'}`, () =>
        get().updateLayer(layerId, patch),
      );
      throw error;
    }
  },

  deleteLayer: async (layerId: string) => {
    try {
      await runMutation(
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
        },
        '无法删除图层',
      );
    } catch (error) {
      get().showCanvasAlert(`无法删除图层：${get().saveError ?? '未知原因'}`, () =>
        get().deleteLayer(layerId),
      );
      throw error;
    }
  },

  undo: async () => {
    try {
      await performUndo(set, get);
    } catch {
      get().showCanvasAlert(`无法撤销：${get().saveError ?? '未知原因'}`, () =>
        performUndo(set, get),
      );
    }
  },

  redo: async () => {
    try {
      await performRedo(set, get);
    } catch {
      get().showCanvasAlert(`无法重做：${get().saveError ?? '未知原因'}`, () =>
        performRedo(set, get),
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
    // Keep the retry so the status bar's "保存失败 · 重试" still works.
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

  markStrokesPersisted: () => {
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

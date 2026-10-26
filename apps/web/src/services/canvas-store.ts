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
  undoCanvas,
  updateLayer as updateLayerRequest,
} from './api';

const STORAGE_KEY = 'paintcodex.canvasId';

export type CanvasStatus = 'idle' | 'loading' | 'ready' | 'error';

interface CanvasState {
  canvas: CanvasDocument | null;
  status: CanvasStatus;
  error: string | null;
  /**
   * The canvas id the UI is waiting for. Distinguishes "load failed" (id exists)
   * from "no canvas yet" (id null) once `canvas` is null in both cases.
   */
  requestedCanvasId: string | null;
  saving: boolean;
  activeLayerId: string | null;
  createNewCanvas: () => Promise<void>;
  loadCanvas: (id: string) => Promise<void>;
  refreshCanvas: () => Promise<void>;
  createLayer: (input: CreateLayerInput) => Promise<Layer | null>;
  updateLayer: (layerId: string, patch: UpdateLayerPatch) => Promise<void>;
  deleteLayer: (layerId: string) => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  setActiveLayer: (layerId: string | null) => void;
}

type SetState = (partial: Partial<CanvasState>) => void;
type GetState = () => CanvasState;

let mutationQueue: Promise<unknown> = Promise.resolve();

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

async function runMutation(
  set: SetState,
  task: () => Promise<void>,
  fallbackError: string,
): Promise<void> {
  set({ saving: true, error: null });

  try {
    await enqueueMutation(task);
    set({ saving: false });
  } catch (error) {
    set({
      saving: false,
      error: error instanceof Error ? error.message : fallbackError,
    });
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

export const useCanvasStore = create<CanvasState>((set, get) => ({
  canvas: null,
  status: 'idle',
  error: null,
  requestedCanvasId: null,
  saving: false,
  activeLayerId: null,

  createNewCanvas: async () => {
    set({ status: 'loading', error: null });

    try {
      const canvas = await createCanvas();
      rememberCanvas(canvas.id);
      set({
        canvas,
        status: 'ready',
        error: null,
        requestedCanvasId: canvas.id,
        activeLayerId: topLayerId(canvas),
      });
    } catch (error) {
      set({
        status: 'error',
        error: error instanceof Error ? error.message : '无法创建画布',
      });
    }
  },

  loadCanvas: async (id: string) => {
    set({ status: 'loading', error: null, requestedCanvasId: id });

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
      set({
        error: error instanceof Error ? error.message : '无法刷新画布',
      });
    }
  },

  createLayer: async (input: CreateLayerInput) => {
    let created: Layer | null = null;

    await runMutation(
      set,
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
    await runMutation(
      set,
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
  },

  deleteLayer: async (layerId: string) => {
    await runMutation(
      set,
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
  },

  undo: async () => {
    try {
      await runMutation(
        set,
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
    } catch {
      // runMutation already surfaced the error.
    }
  },

  redo: async () => {
    try {
      await runMutation(
        set,
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
    } catch {
      // runMutation already surfaced the error.
    }
  },

  setActiveLayer: (layerId: string | null) => {
    set({ activeLayerId: layerId });
  },
}));

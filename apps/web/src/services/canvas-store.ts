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

export const useCanvasStore = create<CanvasState>((set, get) => ({
  canvas: null,
  status: 'idle',
  error: null,
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
        activeLayerId: topLayerId(canvas),
      });
    } catch (error) {
      set({
        status: 'error',
        error: error instanceof Error ? error.message : 'Could not create canvas',
      });
    }
  },

  loadCanvas: async (id: string) => {
    set({ status: 'loading', error: null });

    try {
      const canvas = await getCanvas(id);
      rememberCanvas(canvas.id);
      set({
        canvas,
        status: 'ready',
        error: null,
        activeLayerId: topLayerId(canvas),
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        rememberCanvas(null);
      }

      set({
        canvas: null,
        status: 'error',
        error: error instanceof Error ? error.message : 'Could not load canvas',
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
      const activeLayerId = get().activeLayerId;
      const keepActive =
        activeLayerId !== null &&
        updated.layers.some((layer) => layer.id === activeLayerId);

      set({
        canvas: updated,
        status: 'ready',
        activeLayerId: keepActive ? activeLayerId : topLayerId(updated),
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Could not refresh canvas',
      });
    }
  },

  createLayer: async (input: CreateLayerInput) => {
    set({ saving: true, error: null });

    try {
      let created: Layer | null = null;

      await enqueueMutation(async () => {
        const current = get().canvas;

        if (!current) {
          throw new Error('No canvas loaded');
        }

        const updated = await createLayerRequest(current.id, input, current.revision);
        created = updated.layers[updated.layers.length - 1] ?? null;
        set({
          canvas: updated,
          status: 'ready',
          activeLayerId: created?.id ?? get().activeLayerId,
        });
      });

      set({ saving: false });
      return created;
    } catch (error) {
      set({
        saving: false,
        error: error instanceof Error ? error.message : 'Could not save layer',
      });
      throw error;
    }
  },

  updateLayer: async (layerId: string, patch: UpdateLayerPatch) => {
    set({ saving: true, error: null });

    try {
      await enqueueMutation(async () => {
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
      });

      set({ saving: false });
    } catch (error) {
      set({
        saving: false,
        error: error instanceof Error ? error.message : 'Could not update layer',
      });
      throw error;
    }
  },

  deleteLayer: async (layerId: string) => {
    set({ saving: true, error: null });

    try {
      await enqueueMutation(async () => {
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
      });

      set({ saving: false });
    } catch (error) {
      set({
        saving: false,
        error: error instanceof Error ? error.message : 'Could not delete layer',
      });
      throw error;
    }
  },

  undo: async () => {
    set({ saving: true, error: null });

    try {
      await enqueueMutation(async () => {
        const current = get().canvas;

        if (!current) {
          throw new Error('No canvas loaded');
        }

        const updated = await undoCanvas(current.id, current.revision);
        const activeLayerId = get().activeLayerId;
        const keepActive =
          activeLayerId !== null &&
          updated.layers.some((layer) => layer.id === activeLayerId);

        set({
          canvas: updated,
          status: 'ready',
          activeLayerId: keepActive ? activeLayerId : topLayerId(updated),
        });
      });

      set({ saving: false });
    } catch (error) {
      set({
        saving: false,
        error: error instanceof Error ? error.message : 'Could not undo',
      });
    }
  },

  redo: async () => {
    set({ saving: true, error: null });

    try {
      await enqueueMutation(async () => {
        const current = get().canvas;

        if (!current) {
          throw new Error('No canvas loaded');
        }

        const updated = await redoCanvas(current.id, current.revision);
        const activeLayerId = get().activeLayerId;
        const keepActive =
          activeLayerId !== null &&
          updated.layers.some((layer) => layer.id === activeLayerId);

        set({
          canvas: updated,
          status: 'ready',
          activeLayerId: keepActive ? activeLayerId : topLayerId(updated),
        });
      });

      set({ saving: false });
    } catch (error) {
      set({
        saving: false,
        error: error instanceof Error ? error.message : 'Could not redo',
      });
    }
  },

  setActiveLayer: (layerId: string | null) => {
    set({ activeLayerId: layerId });
  },
}));

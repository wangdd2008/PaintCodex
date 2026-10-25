import { create } from 'zustand';
import type { CanvasDocument } from '@paintcodex/protocol';
import { ApiError, createCanvas, getCanvas } from './api';

const STORAGE_KEY = 'paintcodex.canvasId';

export type CanvasStatus = 'idle' | 'loading' | 'ready' | 'error';

interface CanvasState {
  canvas: CanvasDocument | null;
  status: CanvasStatus;
  error: string | null;
  createNewCanvas: () => Promise<void>;
  loadCanvas: (id: string) => Promise<void>;
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

export const useCanvasStore = create<CanvasState>((set) => ({
  canvas: null,
  status: 'idle',
  error: null,

  createNewCanvas: async () => {
    set({ status: 'loading', error: null });

    try {
      const canvas = await createCanvas();
      rememberCanvas(canvas.id);
      set({ canvas, status: 'ready', error: null });
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
      set({ canvas, status: 'ready', error: null });
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
}));

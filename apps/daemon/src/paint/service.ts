import { randomUUID } from 'node:crypto';
import type { CanvasDocument, CreateCanvasRequest } from '@paintcodex/protocol';
import { CanvasRepository } from './repository.js';

export const DEFAULT_CANVAS_WIDTH = 1920;
export const DEFAULT_CANVAS_HEIGHT = 1080;
export const MAX_CANVAS_DIMENSION = 8192;

export class PaintService {
  constructor(private readonly canvases: CanvasRepository) {}

  createCanvas(input: CreateCanvasRequest = {}): CanvasDocument {
    const now = Date.now();
    const canvas = this.canvases.create({
      id: randomUUID(),
      name: input.name?.trim() || 'Untitled',
      width: input.width ?? DEFAULT_CANVAS_WIDTH,
      height: input.height ?? DEFAULT_CANVAS_HEIGHT,
      backgroundColor: input.backgroundColor ?? '#ffffff',
      revision: 0,
      createdAt: now,
      updatedAt: now,
    });

    return { ...canvas, layers: [] };
  }

  getCanvas(id: string): CanvasDocument | null {
    const canvas = this.canvases.findById(id);

    return canvas ? { ...canvas, layers: [] } : null;
  }
}

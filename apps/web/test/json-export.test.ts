import { describe, expect, it, vi } from 'vitest';
import { canvasJsonFilename, downloadCanvasJson } from '../src/services/json-export';
import type { CanvasDocument } from '@paintcodex/protocol';

describe('canvasJsonFilename', () => {
  it('builds a json filename from the canvas name', () => {
    expect(canvasJsonFilename('Sunset Study')).toBe('Sunset-Study.json');
  });

  it('strips characters that are illegal on Windows', () => {
    expect(canvasJsonFilename('a\\b/c:d*e?f"g<h>i|j')).toBe('abcdefghij.json');
  });

  it('collapses whitespace and trims the edges', () => {
    expect(canvasJsonFilename('  Night \t sky  ')).toBe('Night-sky.json');
  });

  it('falls back to paintcodex.json when nothing usable remains', () => {
    expect(canvasJsonFilename('   ')).toBe('paintcodex.json');
    expect(canvasJsonFilename('')).toBe('paintcodex.json');
    expect(canvasJsonFilename(null)).toBe('paintcodex.json');
  });

  it('does not add a second json extension', () => {
    expect(canvasJsonFilename('Data.JSON')).toBe('Data.JSON');
  });
});

describe('downloadCanvasJson', () => {
  it('creates a blob and triggers a download', () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:test');
    const revokeObjectURL = vi.fn();
    const click = vi.fn();
    const append = vi.fn();
    const remove = vi.fn();

    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });

    const anchorMock = {
      href: '',
      download: '',
      rel: '',
      style: { display: '' },
      click,
      append,
      remove,
    };

    vi.stubGlobal('document', {
      createElement: vi.fn().mockReturnValue(anchorMock),
      body: { append: vi.fn(), removeChild: vi.fn() },
    });

    vi.stubGlobal('setTimeout', vi.fn());

    const canvas: CanvasDocument = {
      id: 'test-id',
      name: 'Test',
      width: 100,
      height: 100,
      backgroundColor: '#ffffff',
      revision: 1,
      createdAt: 0,
      updatedAt: 0,
      layers: [],
      history: { canUndo: false, canRedo: false },
    };

    downloadCanvasJson(canvas, 'test.json');

    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(anchorMock.download).toBe('test.json');
    expect(anchorMock.href).toBe('blob:test');
    expect(click).toHaveBeenCalledOnce();
    expect(setTimeout).toHaveBeenCalledOnce();

    vi.unstubAllGlobals();
  });
});

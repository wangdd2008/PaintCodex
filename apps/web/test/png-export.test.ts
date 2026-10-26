import { describe, expect, it } from 'vitest';
import { canvasPngFilename, dataUrlToBlob } from '../src/services/png-export';

const ONE_PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

describe('canvasPngFilename', () => {
  it('builds a png filename from the canvas name', () => {
    expect(canvasPngFilename('Sunset Study')).toBe('Sunset-Study.png');
  });

  it('appends the first 8 characters of the canvas id', () => {
    expect(canvasPngFilename('未命名 2026-10-27 00:50', '3f9a1c2d-aaaa-bbbb')).toBe(
      '未命名-2026-10-27-0050-3f9a1c2d.png',
    );
    expect(canvasPngFilename('A', '1234567890')).toBe('A-12345678.png');
  });

  it('keeps same-name canvases from overwriting each other', () => {
    const name = '未命名 2026-10-27 00:50';

    expect(canvasPngFilename(name, '3f9a1c2d-aaaa')).not.toBe(
      canvasPngFilename(name, '9b8c7d6e-bbbb'),
    );
  });

  it('strips characters that are illegal on Windows', () => {
    expect(canvasPngFilename('a\\b/c:d*e?f"g<h>i|j')).toBe('abcdefghij.png');
  });

  it('collapses whitespace and trims the edges', () => {
    expect(canvasPngFilename('  Night \t sky  ')).toBe('Night-sky.png');
  });

  it('falls back to paintcodex.png when nothing usable remains', () => {
    expect(canvasPngFilename('   ')).toBe('paintcodex.png');
    expect(canvasPngFilename('')).toBe('paintcodex.png');
    expect(canvasPngFilename(null)).toBe('paintcodex.png');
  });

  it('keeps the fallback basename when the name is empty but an id exists', () => {
    expect(canvasPngFilename('   ', '3f9a1c2d-aaaa')).toBe(
      'paintcodex-3f9a1c2d.png',
    );
  });

  it('does not add a second png extension', () => {
    expect(canvasPngFilename('Sketch.PNG')).toBe('Sketch.PNG');
  });
});

describe('dataUrlToBlob', () => {
  it('decodes a base64 png data url into a png blob', async () => {
    const blob = dataUrlToBlob(`data:image/png;base64,${ONE_PIXEL_PNG_BASE64}`);

    expect(blob.type).toBe('image/png');

    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(Array.from(bytes.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  it('rejects strings that are not data urls', () => {
    expect(() => dataUrlToBlob('https://example.test/canvas.png')).toThrow(/data url/i);
  });
});

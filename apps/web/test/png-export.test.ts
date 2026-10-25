import { describe, expect, it } from 'vitest';
import { canvasPngFilename, dataUrlToBlob } from '../src/services/png-export';

const ONE_PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

describe('canvasPngFilename', () => {
  it('builds a png filename from the canvas name', () => {
    expect(canvasPngFilename('Sunset Study')).toBe('Sunset-Study.png');
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

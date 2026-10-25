import type { CanvasDocument } from '@paintcodex/protocol';

const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|]/g;
const WHITESPACE_RUN = /\s+/g;
const EDGE_DASHES = /^-+|-+$/g;
const TRAILING_DOTS = /\.+$/;
const JSON_EXTENSION = /\.json$/i;
const FALLBACK_BASENAME = 'paintcodex';

export interface CanvasJsonExport {
  version: string;
  exportedAt: number;
  canvas: CanvasDocument;
}

/**
 * Turns a canvas name into a safe `<name>.json` download name.
 */
export function canvasJsonFilename(name: string | null | undefined): string {
  const sanitized = (name ?? '')
    .replace(ILLEGAL_FILENAME_CHARS, '')
    .replace(WHITESPACE_RUN, '-')
    .replace(EDGE_DASHES, '')
    .replace(TRAILING_DOTS, '');

  if (!sanitized) {
    return `${FALLBACK_BASENAME}.json`;
  }

  return JSON_EXTENSION.test(sanitized) ? sanitized : `${sanitized}.json`;
}

/**
 * Serialises canvas data into a JSON blob and triggers a browser download.
 */
export function downloadCanvasJson(canvas: CanvasDocument, filename: string): void {
  const exportData: CanvasJsonExport = {
    version: '1.0',
    exportedAt: Date.now(),
    canvas,
  };

  const json = JSON.stringify(exportData, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';

  document.body.append(anchor);
  anchor.click();
  anchor.remove();

  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

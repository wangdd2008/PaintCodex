import type { CanvasDocument } from '@paintcodex/protocol';

const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|]/g;
const WHITESPACE_RUN = /\s+/g;
const EDGE_DASHES = /^-+|-+$/g;
const TRAILING_DOTS = /\.+$/;
const JSON_EXTENSION = /\.json$/i;
const FALLBACK_BASENAME = 'paintcodex';
/** 与画布名的短 id 后缀一起，避免两分钟内创建的同名画布导出的文件互覆。 */
const SHORT_ID_LENGTH = 8;

function sanitizedBasename(value: string): string {
  return value
    .replace(ILLEGAL_FILENAME_CHARS, '')
    .replace(WHITESPACE_RUN, '-')
    .replace(EDGE_DASHES, '')
    .replace(TRAILING_DOTS, '');
}

export interface CanvasJsonExport {
  version: string;
  exportedAt: number;
  canvas: CanvasDocument;
}

/**
 * 把画布名与画布 id 折成安全的 `<name>-<short-id>.json` 下载名。
 */
export function canvasJsonFilename(
  name: string | null | undefined,
  id?: string | null,
): string {
  const base = sanitizedBasename(name ?? '');
  const shortId = sanitizedBasename((id ?? '').slice(0, SHORT_ID_LENGTH));
  const basename = shortId ? `${base || FALLBACK_BASENAME}-${shortId}` : base;

  if (!basename) {
    return `${FALLBACK_BASENAME}.json`;
  }

  return JSON_EXTENSION.test(basename) ? basename : `${basename}.json`;
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

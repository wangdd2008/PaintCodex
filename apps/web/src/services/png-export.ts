const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|]/g;
const WHITESPACE_RUN = /\s+/g;
const EDGE_DASHES = /^-+|-+$/g;
const TRAILING_DOTS = /\.+$/;
const PNG_EXTENSION = /\.png$/i;
const FALLBACK_BASENAME = 'paintcodex';
const DEFAULT_MEDIA_TYPE = 'application/octet-stream';

declare global {
  interface Window {
    __paintcodexPngExport?: {
      dataUrl: string;
      filename: string;
      byteLength: number;
    };
  }
}

/**
 * Turns a canvas name into a safe `<name>.png` download name. Characters that
 * Windows rejects, plus whitespace, are normalised away; empty names fall back
 * to `paintcodex.png`.
 */
export function canvasPngFilename(name: string | null | undefined): string {
  const sanitized = (name ?? '')
    .replace(ILLEGAL_FILENAME_CHARS, '')
    .replace(WHITESPACE_RUN, '-')
    .replace(EDGE_DASHES, '')
    .replace(TRAILING_DOTS, '');

  if (!sanitized) {
    return `${FALLBACK_BASENAME}.png`;
  }

  return PNG_EXTENSION.test(sanitized) ? sanitized : `${sanitized}.png`;
}

/**
 * Decodes a base64 (or URL-encoded) data URL into a Blob without touching the
 * DOM, so it stays testable outside a browser.
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  if (!dataUrl.startsWith('data:')) {
    throw new Error('Expected a data URL');
  }

  const commaIndex = dataUrl.indexOf(',');

  if (commaIndex < 0) {
    throw new Error('Malformed data URL: missing payload separator');
  }

  const metadata = dataUrl.slice('data:'.length, commaIndex);
  const payload = dataUrl.slice(commaIndex + 1);
  const isBase64 = /;base64$/i.test(metadata);
  const mediaType =
    metadata.replace(/;base64$/i, '').split(';')[0] || DEFAULT_MEDIA_TYPE;

  if (!isBase64) {
    return new Blob([decodeURIComponent(payload)], { type: mediaType });
  }

  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: mediaType });
}

/** Downloads a data URL as a file and releases the object URL afterwards. */
export function downloadPng(dataUrl: string, filename: string): void {
  const blob = dataUrlToBlob(dataUrl);
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';

  document.body.append(anchor);
  anchor.click();
  anchor.remove();

  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);

  if (import.meta.env.DEV) {
    window.__paintcodexPngExport = {
      dataUrl,
      filename,
      byteLength: blob.size,
    };
  }
}

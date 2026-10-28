export type AppView = 'canvas' | 'canvases' | 'monitor';

/**
 * 视图由 URL 的 `page` 查询参数决定（ADR-0010 §5）：
 * - `?page=canvases` → 画布库
 * - `?page=monitor` → 监控
 * - 其余（含无 `page`）→ 画布视图。画布视图本身不挂 `page`。
 */
export function readViewFromSearch(search: string): AppView {
  const page = new URLSearchParams(search).get('page');

  if (page === 'monitor') {
    return 'monitor';
  }

  if (page === 'canvases') {
    return 'canvases';
  }

  return 'canvas';
}

/**
 * Builds the URL for a view while preserving unrelated query parameters and
 * the hash. Returned as a path so it can be passed straight to `pushState`.
 */
export function buildViewUrl(href: string, view: AppView): string {
  const url = new URL(href);

  if (view === 'monitor') {
    url.searchParams.set('page', 'monitor');
  } else if (view === 'canvases') {
    // 库没有活动画布：地址栏不留 canvasId，否则后退到库时它会粘在 URL 上。
    url.searchParams.delete('canvasId');
    url.searchParams.set('page', 'canvases');
  } else {
    url.searchParams.delete('page');
  }

  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Builds the URL for opening one canvas document: drop the view parameter,
 * point at the id. Entering a canvas pushes this history entry so the browser
 * back button lands back on the library.
 */
export function buildCanvasUrl(href: string, canvasId: string): string {
  const url = new URL(href);

  url.searchParams.delete('page');
  url.searchParams.set('canvasId', canvasId);

  return `${url.pathname}${url.search}${url.hash}`;
}

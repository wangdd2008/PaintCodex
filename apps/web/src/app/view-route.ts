export type AppView = 'canvas' | 'monitor';

export function readViewFromSearch(search: string): AppView {
  return new URLSearchParams(search).get('page') === 'monitor' ? 'monitor' : 'canvas';
}

/**
 * Builds the URL for a view while preserving unrelated query parameters and
 * the hash. Returned as a path so it can be passed straight to `pushState`.
 */
export function buildViewUrl(href: string, view: AppView): string {
  const url = new URL(href);

  if (view === 'monitor') {
    url.searchParams.set('page', 'monitor');
  } else {
    url.searchParams.delete('page');
  }

  return `${url.pathname}${url.search}${url.hash}`;
}

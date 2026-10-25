import { describe, expect, it } from 'vitest';
import { buildViewUrl, readViewFromSearch } from '../src/app/view-route';

describe('readViewFromSearch', () => {
  it('defaults to the canvas view', () => {
    expect(readViewFromSearch('')).toBe('canvas');
    expect(readViewFromSearch('?foo=1')).toBe('canvas');
  });

  it('reads the monitor view from the page query parameter', () => {
    expect(readViewFromSearch('?page=monitor')).toBe('monitor');
    expect(readViewFromSearch('?page=monitor&foo=1')).toBe('monitor');
  });

  it('treats unknown page values as the canvas view', () => {
    expect(readViewFromSearch('?page=canvas')).toBe('canvas');
    expect(readViewFromSearch('?page=Monitor')).toBe('canvas');
  });
});

describe('buildViewUrl', () => {
  it('removes the page parameter when returning to the canvas', () => {
    expect(buildViewUrl('http://localhost:5173/?page=monitor', 'canvas')).toBe('/');
  });

  it('keeps unrelated query parameters and the hash', () => {
    expect(buildViewUrl('http://localhost:5173/?foo=1#top', 'monitor')).toBe(
      '/?foo=1&page=monitor#top',
    );
  });

  it('keeps the current pathname', () => {
    expect(buildViewUrl('http://localhost:5173/monitor?page=monitor', 'canvas')).toBe('/monitor');
  });
});

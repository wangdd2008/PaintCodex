import { describe, expect, it } from 'vitest';
import {
  buildCanvasUrl,
  buildViewUrl,
  readViewFromSearch,
} from '../src/app/view-route';

describe('readViewFromSearch', () => {
  it('defaults to the canvas view', () => {
    expect(readViewFromSearch('')).toBe('canvas');
    expect(readViewFromSearch('?foo=1')).toBe('canvas');
  });

  it('reads the monitor view from the page query parameter', () => {
    expect(readViewFromSearch('?page=monitor')).toBe('monitor');
    expect(readViewFromSearch('?page=monitor&foo=1')).toBe('monitor');
  });

  it('reads the canvas library view from the page query parameter', () => {
    expect(readViewFromSearch('?page=canvases')).toBe('canvases');
    expect(readViewFromSearch('?page=canvases&foo=1')).toBe('canvases');
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

  it('sets page=canvases for the library and drops the canvas id', () => {
    expect(
      buildViewUrl('http://localhost:5173/?canvasId=abc', 'canvases'),
    ).toBe('/?page=canvases');
  });
});

describe('buildCanvasUrl', () => {
  it('points at one canvas document and clears the page parameter', () => {
    expect(
      buildCanvasUrl('http://localhost:5173/?page=canvases', 'abc'),
    ).toBe('/?canvasId=abc');
  });

  it('replaces an existing canvas id rather than appending a duplicate', () => {
    expect(
      buildCanvasUrl('http://localhost:5173/?canvasId=old&foo=1', 'new'),
    ).toBe('/?canvasId=new&foo=1');
  });
});

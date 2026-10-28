import { describe, expect, it } from 'vitest';
import { computeZoomPercent } from '../src/services/viewport-store';

describe('状态栏缩放百分比（直接来自当前 scale）', () => {
  it('scale 0.447 → 44.7%', () => {
    expect(computeZoomPercent(0.447)).toBe(44.7);
  });

  it('按 scale * 100 并保留一位小数', () => {
    expect(computeZoomPercent(1)).toBe(100);
    expect(computeZoomPercent(0.5)).toBe(50);
    expect(computeZoomPercent(0.203)).toBe(20.3);
    expect(computeZoomPercent(0.521)).toBe(52.1);
  });

  it('夹在上下限附近的百分比', () => {
    expect(computeZoomPercent(0.05)).toBe(5);
    expect(computeZoomPercent(8)).toBe(800);
  });

  it('不可用的 scale 返回 0，不产生 NaN 文案', () => {
    expect(computeZoomPercent(0)).toBe(0);
    expect(computeZoomPercent(Number.NaN)).toBe(0);
    expect(computeZoomPercent(-1)).toBe(0);
  });
});

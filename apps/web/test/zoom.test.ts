import { describe, expect, it } from 'vitest';
import { computeZoomPercent } from '../src/services/viewport-store';

describe('真实缩放计算', () => {
  it('858 / 1920 = 44.7%', () => {
    expect(computeZoomPercent(858, 1920)).toBe(44.7);
  });

  it('按渲染宽度 / 文档宽度计算并保留一位小数', () => {
    expect(computeZoomPercent(1920, 1920)).toBe(100);
    expect(computeZoomPercent(960, 1920)).toBe(50);
    expect(computeZoomPercent(390, 1920)).toBe(20.3);
    expect(computeZoomPercent(1000, 1920)).toBe(52.1);
  });

  it('不可用的宽度返回 0，不产生 NaN 文案', () => {
    expect(computeZoomPercent(0, 1920)).toBe(0);
    expect(computeZoomPercent(Number.NaN, 1920)).toBe(0);
    expect(computeZoomPercent(858, 0)).toBe(0);
  });
});

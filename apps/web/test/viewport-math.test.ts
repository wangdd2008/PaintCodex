import { describe, expect, it } from 'vitest';
import {
  clampScale,
  docRectToScreen,
  docToScreen,
  fitScale,
  fitViewport,
  MAX_SCALE,
  MIN_SCALE,
} from '../src/services/viewport-math';

/**
 * 纯函数 seam：缩放/平移的数学不碰 Fabric。期望值都是手算的字面量，
 * 不重新走一遍实现算式，避免 tautological。
 */
describe('fitScale：内容完整放进容器的等比缩放', () => {
  it('容器正好等于文档尺寸时为 1', () => {
    expect(fitScale(1920, 1080, 1920, 1080)).toBe(1);
  });

  it('宽受限：800×600 容器装 1920×1080 文档，取 800/1920 = 5/12', () => {
    // 800/1920 = 0.41666…，600/1080 = 0.55555…，取较小者
    expect(fitScale(800, 600, 1920, 1080)).toBeCloseTo(5 / 12, 5);
  });

  it('高受限：1080×1920 容器装 1920×1080 文档，取 1080/1920 = 0.5625', () => {
    expect(fitScale(1080, 1920, 1920, 1080)).toBeCloseTo(0.5625, 5);
  });

  it('容器比文档大时允许放大到 >1，不封顶', () => {
    // 3840×2160 容器装 1920×1080 文档，取 2
    expect(fitScale(3840, 2160, 1920, 1080)).toBe(2);
  });

  it('测不到容器尺寸（jsdom / 未布局）时回退到 1，避免 0 缩放', () => {
    expect(fitScale(0, 0, 1920, 1080)).toBe(1);
    expect(fitScale(-1, 600, 1920, 1080)).toBe(1);
  });
});

describe('clampScale：scale 限制在 [0.05, 8]', () => {
  it('低于下限夹到下限', () => {
    expect(clampScale(0.01)).toBe(MIN_SCALE);
    expect(clampScale(0)).toBe(MIN_SCALE);
  });

  it('高于上限夹到上限', () => {
    expect(clampScale(12)).toBe(MAX_SCALE);
    expect(clampScale(100)).toBe(MAX_SCALE);
  });

  it('边界值本身不变', () => {
    expect(clampScale(MIN_SCALE)).toBe(MIN_SCALE);
    expect(clampScale(MAX_SCALE)).toBe(MAX_SCALE);
  });

  it('区间内的值原样返回', () => {
    expect(clampScale(1)).toBe(1);
    expect(clampScale(0.447)).toBe(0.447);
    expect(clampScale(3.2)).toBe(3.2);
  });
});

describe('docToScreen：文档坐标 → 屏幕像素', () => {
  it('vpt = [0.5,0,0,0.5,10,20]：原点文档点落在偏移处', () => {
    const vpt = [0.5, 0, 0, 0.5, 10, 20] as const;
    expect(docToScreen(0, 0, vpt)).toEqual({ x: 10, y: 20 });
  });

  it('vpt = [0.5,0,0,0.5,10,20]：文档右下角 1920×1080 映射到 970×560', () => {
    // 1920*0.5 + 10 = 970；1080*0.5 + 20 = 560
    const vpt = [0.5, 0, 0, 0.5, 10, 20] as const;
    expect(docToScreen(1920, 1080, vpt)).toEqual({ x: 970, y: 560 });
  });
});

describe('docRectToScreen：文档矩形 → 屏幕像素矩形（②05 叠加层换算）', () => {
  it('vpt = [0.5,0,0,0.5,10,20]：左上角与右下角分别过 docToScreen', () => {
    // 左上：100*0.5+10=60，50*0.5+20=45；右下：300*0.5+10=160，150*0.5+20=95
    const vpt = [0.5, 0, 0, 0.5, 10, 20] as const;
    expect(
      docRectToScreen({ left: 100, top: 50, width: 200, height: 100 }, vpt),
    ).toEqual({ left: 60, top: 45, width: 100, height: 50 });
  });

  it('200% 缩放 + 偏移：文档 100×100 框映射成 200×200 屏幕框', () => {
    // 100*2+5=205；0*2+5=5；宽高 100*2=200
    const vpt = [2, 0, 0, 2, 5, 5] as const;
    expect(
      docRectToScreen({ left: 0, top: 0, width: 100, height: 100 }, vpt),
    ).toEqual({ left: 5, top: 5, width: 200, height: 200 });
  });

  it('单位矩阵时文档像素即屏幕像素', () => {
    const vpt = [1, 0, 0, 1, 0, 0] as const;
    expect(
      docRectToScreen({ left: 100, top: 50, width: 200, height: 100 }, vpt),
    ).toEqual({ left: 100, top: 50, width: 200, height: 100 });
  });
});

describe('fitViewport：fit 变换矩阵，内容居中', () => {
  it('宽受限 800×600 装 1920×1080：水平贴边、垂直居中', () => {
    // s = 5/12；内容宽 800 贴满、高 450，垂直余量 (600-450)/2 = 75
    const vpt = fitViewport(800, 600, 1920, 1080);
    expect(vpt[0]).toBeCloseTo(5 / 12, 5);
    expect(vpt[4]).toBe(0);
    expect(vpt[5]).toBe(75);
  });

  it('高受限 1000×1000 装 1920×1080：垂直贴边、水平居中', () => {
    // s = 1000/1920 ≈ 0.520833；内容宽 1000、高 562.5；水平余量 (1000-1000)/2 = 0
    // 等等：1920*s = 1000，1080*s = 562.5；水平余量 0，垂直余量 (1000-562.5)/2 = 218.75
    const vpt = fitViewport(1000, 1000, 1920, 1080);
    expect(vpt[0]).toBeCloseTo(1000 / 1920, 5);
    expect(vpt[4]).toBeCloseTo(0, 5);
    expect(vpt[5]).toBeCloseTo(218.75, 5);
  });

  it('容器等于文档尺寸时为单位矩阵', () => {
    expect(fitViewport(1920, 1080, 1920, 1080)).toEqual([1, 0, 0, 1, 0, 0]);
  });
});

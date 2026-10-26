// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CanvasDocument, Layer } from '@paintcodex/protocol';
import { cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { LayerPanel } from '../src/features/layer-panel/LayerPanel';
import { useCanvasStore } from '../src/services/canvas-store';

const testDir = dirname(fileURLToPath(import.meta.url));
const layerPanelCss = readFileSync(
  resolve(testDir, '../src/features/layer-panel/layer-panel.css'),
  'utf8',
);

/**
 * jsdom 不计算布局，命中区只能以样式表为契约：数值直接从规则体里提取，
 * 这样「放大字号凑尺寸」或「只写 padding」都无法假通过。
 */
function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));

  if (!match?.[1]) {
    throw new Error(`样式文件里找不到规则: ${selector}`);
  }

  return match[1];
}

function px(rule: string, property: string): number | null {
  const match = rule.match(new RegExp(`(?:^|[;\\s])${property}\\s*:\\s*(-?\\d+(?:\\.\\d+)?)px`));
  return match?.[1] ? Number(match[1]) : null;
}

function pxProperty(rule: string, properties: string[]): number {
  return Math.max(...properties.map((property) => px(rule, property) ?? 0));
}

function makeLayer(index: number, visible = true): Layer {
  return {
    id: `layer-${index}`,
    canvasId: 'canvas-1',
    name: `笔迹 ${index}`,
    type: 'raster',
    zIndex: index,
    visible,
    opacity: 1,
    content: { kind: 'fabric', json: '{}' },
    metadata: { createdBy: 'user', createdAt: 0 },
    createdAt: 0,
  };
}

function makeCanvas(layers: Layer[]): CanvasDocument {
  return {
    id: 'canvas-1',
    name: '测试画布',
    width: 1280,
    height: 720,
    backgroundColor: '#ffffff',
    revision: 1,
    createdAt: 0,
    updatedAt: 0,
    layers,
    history: { canUndo: false, canRedo: false },
  };
}

function seedCanvas(layers: Layer[]): void {
  useCanvasStore.setState({
    canvas: makeCanvas(layers),
    activeLayerId: layers.at(-1)?.id ?? null,
    status: 'ready',
    saving: false,
  });
}

afterEach(() => {
  cleanup();
  useCanvasStore.setState({ canvas: null, activeLayerId: null });
});

describe('可见性控件的读屏语义', () => {
  it('aria-label 固定为「{name} 可见性」，aria-pressed 表示是否可见', () => {
    seedCanvas([makeLayer(1, true), makeLayer(2, false)]);

    render(createElement(LayerPanel));

    const shown = screen.getByRole('button', { name: '笔迹 1 可见性' });
    const hidden = screen.getByRole('button', { name: '笔迹 2 可见性' });

    // 名字只描述控件，不描述动作：动作由 aria-pressed 表达。
    expect(shown.getAttribute('aria-label')).toBe('笔迹 1 可见性');
    expect(hidden.getAttribute('aria-label')).toBe('笔迹 2 可见性');
    expect(shown.getAttribute('aria-pressed')).toBe('true');
    expect(hidden.getAttribute('aria-pressed')).toBe('false');
  });
});

describe('图层行命中区 CSS 契约', () => {
  it('行高在 36–40px 之间', () => {
    const item = ruleBody(layerPanelCss, '.layer-item');
    const rowHeight = pxProperty(item, ['height', 'min-height']);

    expect(rowHeight).toBeGreaterThanOrEqual(36);
    expect(rowHeight).toBeLessThanOrEqual(40);
  });

  it('可见性控件 ≥28×28，删除控件 ≥24×24，且不靠放大字号', () => {
    const visibility = ruleBody(layerPanelCss, '.layer-item__visibility');
    const deleteButton = ruleBody(layerPanelCss, '.layer-item__delete');

    expect(pxProperty(visibility, ['width', 'min-width'])).toBeGreaterThanOrEqual(28);
    expect(pxProperty(visibility, ['height', 'min-height'])).toBeGreaterThanOrEqual(28);

    expect(pxProperty(deleteButton, ['width', 'min-width'])).toBeGreaterThanOrEqual(24);
    expect(pxProperty(deleteButton, ['height', 'min-height'])).toBeGreaterThanOrEqual(24);

    // 热区靠 padding/固定尺寸扩展：字形保持原有大小。
    expect(px(visibility, 'font-size')).toBeGreaterThan(0);
    expect(px(visibility, 'font-size') ?? 99).toBeLessThanOrEqual(12);
  });

  it('相邻控件间距 ≥4px', () => {
    const item = ruleBody(layerPanelCss, '.layer-item');
    expect(px(item, 'gap')).toBeGreaterThanOrEqual(4);
  });
});

describe('键盘可达性', () => {
  it('行内控件有 :focus-visible 焦点环', () => {
    expect(layerPanelCss).toMatch(
      /\.layer-item__visibility:focus-visible[^{]*\{[^}]*outline:\s*2px/,
    );
    expect(layerPanelCss).toMatch(
      /\.layer-item__delete:focus-visible[^{]*\{[^}]*outline:\s*2px/,
    );
  });

  it('可见性与删除按钮可聚焦且未被禁用', () => {
    seedCanvas([makeLayer(1)]);

    render(createElement(LayerPanel));

    const visibility = screen.getByRole('button', { name: '笔迹 1 可见性' });
    const remove = screen.getByRole('button', { name: '删除 笔迹 1' });

    for (const button of [visibility, remove]) {
      expect(button.hasAttribute('disabled')).toBe(false);
      expect(button.tabIndex).toBeGreaterThanOrEqual(0);
      button.focus();
      expect(document.activeElement).toBe(button);
    }
  });
});

describe('图标与文字提示', () => {
  it('可见与隐藏使用不同形状（隐藏态带斜线），不只靠颜色', () => {
    seedCanvas([makeLayer(1, true), makeLayer(2, false)]);

    render(createElement(LayerPanel));

    const shownIcon = screen.getByRole('button', { name: '笔迹 1 可见性' }).querySelector('svg');
    const hiddenIcon = screen.getByRole('button', { name: '笔迹 2 可见性' }).querySelector('svg');

    expect(shownIcon?.getAttribute('data-icon')).toBe('eye');
    expect(hiddenIcon?.getAttribute('data-icon')).toBe('eye-off');
    // 斜线是一条独立的描边路径：隐藏态即使去掉颜色也能分辨。
    expect(shownIcon?.querySelectorAll('path')).toHaveLength(1);
    expect(hiddenIcon?.querySelectorAll('path')).toHaveLength(2);
    expect(shownIcon?.getAttribute('aria-hidden')).toBe('true');
    expect(hiddenIcon?.getAttribute('aria-hidden')).toBe('true');
  });

  it('hover 与键盘 focus 都会显示文字提示', () => {
    expect(layerPanelCss).toMatch(
      /\.layer-item__visibility:hover\s*\+\s*\.layer-item__tooltip[^{]*\{[^}]*opacity:\s*1/,
    );
    expect(layerPanelCss).toMatch(
      /\.layer-item__visibility:focus-visible\s*\+\s*\.layer-item__tooltip[^{]*\{[^}]*opacity:\s*1/,
    );

    seedCanvas([makeLayer(1, true), makeLayer(2, false)]);
    render(createElement(LayerPanel));

    const tooltips = Array.from(
      document.querySelectorAll<HTMLElement>('.layer-item__tooltip'),
    ).map((node) => node.textContent);

    expect(tooltips).toEqual(['隐藏图层', '显示图层']);
    // 提示文字属于视觉辅助，不重复读屏名称。
    for (const node of document.querySelectorAll('.layer-item__tooltip')) {
      expect(node.getAttribute('aria-hidden')).toBe('true');
    }
  });
});

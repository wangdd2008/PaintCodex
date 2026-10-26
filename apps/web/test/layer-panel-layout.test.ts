// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CanvasDocument, Layer } from '@paintcodex/protocol';
import { act, cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LayerPanel } from '../src/features/layer-panel/LayerPanel';
import { useCanvasStore } from '../src/services/canvas-store';

const testDir = dirname(fileURLToPath(import.meta.url));

function readCss(relativePath: string): string {
  return readFileSync(resolve(testDir, relativePath), 'utf8');
}

const rawLayerPanelCss = readCss('../src/features/layer-panel/layer-panel.css');
const rawAppCss = readCss('../src/app/app.css');

/**
 * jsdom cannot compute layout, so the panel geometry is pinned twice:
 * - CSS contract: the style sheets contain the constraints the layout relies on.
 * - Component contract: the list is its own scroll container and a newly
 *   created layer is scrolled into view with `block: 'nearest'`.
 */
function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));

  if (!match?.[1]) {
    throw new Error(`样式文件里找不到规则: ${selector}`);
  }

  return match[1];
}

describe('图层布局 CSS 契约', () => {
  it('图层面板限高 300px，列表自己滚动', () => {
    const panel = ruleBody(rawLayerPanelCss, '.layer-panel');
    expect(panel).toMatch(/display:\s*flex/);
    expect(panel).toMatch(/flex-direction:\s*column/);
    expect(panel).toMatch(/max-height:\s*300px/);

    const list = ruleBody(rawLayerPanelCss, '.layer-list');
    expect(list).toMatch(/overflow-y:\s*(auto|scroll)/);
    expect(list).toMatch(/min-height:\s*0/);
  });

  it('侧栏不整体滚动，AI 面板保底 240px', () => {
    const sidePanel = ruleBody(rawAppCss, '.side-panel');
    expect(sidePanel).toMatch(/overflow:\s*hidden/);
    expect(sidePanel).not.toMatch(/overflow-y:\s*(auto|scroll)/);

    const aiPanel = ruleBody(rawAppCss, '.side-panel > .ai-chat');
    expect(aiPanel).toMatch(/flex:\s*1/);
    expect(aiPanel).toMatch(/min-height:\s*240px/);
  });
});

function makeLayer(index: number): Layer {
  return {
    id: `layer-${index}`,
    canvasId: 'canvas-1',
    name: `笔迹 ${index}`,
    type: 'raster',
    zIndex: index,
    visible: true,
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

function setLayers(layers: Layer[]): void {
  act(() => {
    useCanvasStore.setState({ canvas: makeCanvas(layers) });
  });
}

const scrollIntoView = vi.fn();

beforeEach(() => {
  // jsdom does not implement scrolling.
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    writable: true,
    value: scrollIntoView,
  });
});

afterEach(() => {
  cleanup();
  scrollIntoView.mockReset();
  useCanvasStore.setState({ canvas: null, activeLayerId: null });
});

describe('LayerPanel 滚动容器', () => {
  it('图层列表是独立的滚动容器', () => {
    seedCanvas([makeLayer(1), makeLayer(2)]);

    render(createElement(LayerPanel));

    const list = screen.getByRole('list');
    expect(list.classList.contains('layer-list')).toBe(true);
    expect(list.querySelectorAll('li')).toHaveLength(2);
  });

  it('新图层渲染后调用 scrollIntoView({ block: nearest })', () => {
    const layers = Array.from({ length: 8 }, (_, index) => makeLayer(index + 1));
    seedCanvas(layers);
    render(createElement(LayerPanel));

    expect(scrollIntoView).not.toHaveBeenCalled();

    const newest = makeLayer(9);
    setLayers([...layers, newest]);

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
    expect((scrollIntoView.mock.contexts[0] as HTMLElement).textContent).toContain(
      newest.name,
    );
  });

  it('既有图层更新时不滚动', () => {
    const layers = Array.from({ length: 8 }, (_, index) => makeLayer(index + 1));
    seedCanvas(layers);
    render(createElement(LayerPanel));

    setLayers(layers.map((layer, index) => (index === 0 ? { ...layer, visible: false } : layer)));

    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});

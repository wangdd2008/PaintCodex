// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/App';

// jsdom 没有 canvas 2d 上下文，Fabric 无法真实挂载；抽屉行为属于外壳，画布模块换成空实现。
vi.mock('../src/features/canvas/CanvasStage', () => ({
  CanvasStage: () => null,
}));

const testDir = dirname(fileURLToPath(import.meta.url));
const rawAppCss = readFileSync(resolve(testDir, '../src/app/app.css'), 'utf8');

/**
 * jsdom 不计算布局，窄屏承诺只能钉两层：
 * - CSS 契约：样式表里确实存在三档断点与各自的宽度/换行约束。
 * - 组件契约：「图层」开关驱动抽屉开合，Esc 关闭并把焦点还给触发按钮。
 */
function mediaBlock(css: string, query: string): string {
  const marker = `@media (max-width: ${query})`;
  const start = css.indexOf(marker);

  if (start === -1) {
    throw new Error(`样式文件里找不到断点: ${marker}`);
  }

  const open = css.indexOf('{', start);
  let depth = 0;

  for (let index = open; index < css.length; index += 1) {
    if (css[index] === '{') {
      depth += 1;
    } else if (css[index] === '}') {
      depth -= 1;

      if (depth === 0) {
        return css.slice(open + 1, index);
      }
    }
  }

  throw new Error(`断点没有闭合: ${marker}`);
}

function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));

  if (!match?.[1]) {
    throw new Error(`样式文件里找不到规则: ${selector}`);
  }

  return match[1];
}

describe('窄屏 CSS 契约', () => {
  it('至少三档断点：1100 / 860 / 560', () => {
    const breakpoints = rawAppCss.match(/@media\s*\(max-width:\s*\d+px\)/g) ?? [];
    expect(breakpoints.length).toBeGreaterThanOrEqual(3);

    for (const width of ['1100px', '860px', '560px']) {
      expect(() => mediaBlock(rawAppCss, width)).not.toThrow();
    }
  });

  it('≤1100px：侧栏 clamp(260px, 24vw, 320px)，工具条 48px', () => {
    const block = mediaBlock(rawAppCss, '1100px');
    const workspace = ruleBody(block, '.workspace');

    expect(workspace).toMatch(/grid-template-columns:\s*48px\s+minmax\(0,\s*1fr\)\s+clamp\(260px,\s*24vw,\s*320px\)/);

    // 48px 列里两字标签不能一字一行。
    expect(ruleBody(block, '.workspace .toolbox')).toMatch(/padding:\s*12px\s+4px/);
    expect(ruleBody(block, '.workspace .tool-button')).toMatch(/padding:\s*10px\s+2px/);
  });

  it('≤860px：侧栏出流为覆盖式抽屉 min(320px, 86vw)，默认收起', () => {
    const block = mediaBlock(rawAppCss, '860px');
    const workspace = ruleBody(block, '.workspace');

    // 侧栏不再占网格列，画布拿到整行剩余宽度。
    expect(workspace).toMatch(/grid-template-columns:\s*48px\s+minmax\(0,\s*1fr\)/);
    expect(workspace).not.toMatch(/clamp\(/);
    expect(workspace).toMatch(/position:\s*relative/);
    // 移到视口外的抽屉必须被裁掉，否则 document 仍会横向滚动。
    expect(workspace).toMatch(/overflow:\s*hidden/);

    const panel = ruleBody(block, '.side-panel');
    expect(panel).toMatch(/position:\s*(absolute|fixed)/);
    expect(panel).toMatch(/width:\s*min\(320px,\s*86vw\)/);
    expect(panel).toMatch(/transform:\s*translateX\(100%\)/);
    expect(panel).toMatch(/visibility:\s*hidden/);

    const openPanel = ruleBody(block, '.side-panel.side-panel--open');
    expect(openPanel).toMatch(/transform:\s*(none|translateX\(0\))/);
    expect(openPanel).toMatch(/visibility:\s*visible/);

    // 菜单允许换行、隐藏文档名，抽屉开关只在窄屏出现。
    expect(ruleBody(block, '.menu-bar')).toMatch(/flex-wrap:\s*wrap/);
    expect(ruleBody(block, '.document-name')).toMatch(/display:\s*none/);
    expect(ruleBody(block, '.drawer-toggle')).toMatch(/display:\s*(inline-flex|inline-block|block)/);
  });

  it('≤560px：抽屉接近全宽，导出换行，状态栏允许换行，画布留足宽度', () => {
    const block = mediaBlock(rawAppCss, '560px');

    expect(ruleBody(block, '.side-panel')).toMatch(/width:\s*calc\(100%\s*-\s*\d+px\)/);
    expect(ruleBody(block, '.status-bar')).toMatch(/flex-wrap:\s*wrap/);
    // 菜单占满一行的 spacer 把品牌留在第一行，导出等按钮整体落到第二行。
    expect(ruleBody(block, '.menu-spacer')).toMatch(/flex-basis:\s*100%/);
    // 画布列 = 视口 - 48px 工具条；不留内边距才能保证 390px 下 ≥340px。
    expect(ruleBody(block, '.canvas-area')).toMatch(/padding:\s*0/);
  });

  it('≤860px：抽屉内部纵向两段——图层段在上限高可折叠，对话段在下 flex:1，拖宽条隐藏', () => {
    const block = mediaBlock(rawAppCss, '860px');

    // 图层段在上：不撑高、最高 min(360px, 50%)，超出由图层列表内部滚动。
    const layerCol = ruleBody(block, '.side-panel .layer-column');
    expect(layerCol).toMatch(/flex:\s*none|flex:\s*0 0 auto/);
    expect(layerCol).toMatch(/max-height:\s*min\(360px,\s*50%\)/);
    expect(layerCol).toMatch(/overflow:\s*hidden/);

    // 对话段在下：吃满抽屉剩余高度，自己不溢出。
    const chatCol = ruleBody(block, '.side-panel .chat-column');
    expect(chatCol).toMatch(/flex:\s*1/);
    expect(chatCol).toMatch(/min-height:\s*0/);
    expect(chatCol).toMatch(/overflow:\s*hidden/);

    // 两列叠成纵向两段后，横向拖宽条没有意义——隐藏。
    expect(ruleBody(block, '.side-panel .chat-resizer')).toMatch(/display:\s*none/);

    // 消息区在对话段里吃满剩余高度并自己滚动，抽屉本身不滚。
    expect(ruleBody(block, '.side-panel .ai-chat__body')).toMatch(/flex:\s*1/);
    const messages = ruleBody(block, '.side-panel .ai-chat__messages');
    expect(messages).toMatch(/flex:\s*1/);
    expect(messages).not.toMatch(/max-height:\s*280px/);
  });
});

function sidePanel(): HTMLElement {
  const panel = document.querySelector<HTMLElement>('.side-panel');

  if (!panel) {
    throw new Error('找不到侧栏');
  }

  return panel;
}

describe('侧栏抽屉开关', () => {
  beforeEach(() => {
    // jsdom 不实现元素滚动。
    Object.defineProperty(Element.prototype, 'scrollTo', {
      configurable: true,
      value: () => undefined,
    });
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it('点击「图层」展开侧栏，按 Esc 关闭并把焦点还给按钮', () => {
    render(createElement(App));

    const toggle = screen.getByRole('button', { name: '图层' });
    expect(sidePanel().classList.contains('side-panel--open')).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(toggle);
    expect(sidePanel().classList.contains('side-panel--open')).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });

    expect(sidePanel().classList.contains('side-panel--open')).toBe(false);
    expect(document.activeElement).toBe(toggle);
  });

  it('不新增第二个抽屉按钮：全页只有一个「图层」抽屉开关，打开的就是两段抽屉', () => {
    render(createElement(App));

    expect(document.querySelectorAll('.drawer-toggle')).toHaveLength(1);
  });
});

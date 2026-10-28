// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/App';
import { CHAT_WIDTH_DEFAULT, CHAT_WIDTH_MAX, CHAT_WIDTH_MIN, CHAT_WIDTH_STORAGE_KEY } from '../src/services/chat-width';

// jsdom 没有 canvas 2d 上下文，Fabric 无法真实挂载；布局行为属于外壳，画布模块换成空实现。
vi.mock('../src/features/canvas/CanvasStage', () => ({
  CanvasStage: () => null,
}));

function resizer(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[role="separator"]');
  if (!el) {
    throw new Error('找不到分隔条 [role=separator]');
  }
  return el;
}

function chatColumn(): HTMLElement {
  const el = document.querySelector<HTMLElement>('.chat-column');
  if (!el) {
    throw new Error('找不到对话列 .chat-column');
  }
  return el;
}

function layerColumn(): HTMLElement {
  const el = document.querySelector<HTMLElement>('.layer-column');
  if (!el) {
    throw new Error('找不到图层列 .layer-column');
  }
  return el;
}

function chatWidthVar(): string {
  return document.documentElement.style.getPropertyValue('--chat-width');
}

describe('对话列分隔条（票 ②01）', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.style.removeProperty('--chat-width');
    // jsdom 不实现元素滚动。
    Object.defineProperty(Element.prototype, 'scrollTo', {
      configurable: true,
      value: () => undefined,
    });
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    document.documentElement.style.removeProperty('--chat-width');
  });

  it('分隔条具备 role/aria/tabIndex，默认宽度写在 documentElement', () => {
    render(createElement(App));

    const bar = resizer();
    expect(bar.getAttribute('role')).toBe('separator');
    expect(bar.getAttribute('aria-orientation')).toBe('vertical');
    expect(Number(bar.getAttribute('aria-valuemin'))).toBe(CHAT_WIDTH_MIN);
    expect(Number(bar.getAttribute('aria-valuemax'))).toBe(CHAT_WIDTH_MAX);
    expect(Number(bar.getAttribute('aria-valuenow'))).toBe(CHAT_WIDTH_DEFAULT);
    expect(bar.tabIndex).toBe(0);

    // 默认 --chat-width: 380px 写在 documentElement 上。
    expect(chatWidthVar()).toBe(`${CHAT_WIDTH_DEFAULT}px`);
  });

  it('启动时从 localStorage 读回记住的宽度', () => {
    window.localStorage.setItem(CHAT_WIDTH_STORAGE_KEY, '450');
    render(createElement(App));

    expect(chatWidthVar()).toBe('450px');
    expect(Number(resizer().getAttribute('aria-valuenow'))).toBe(450);
  });

  it('→ +16px，← −16px，并写回 localStorage', () => {
    render(createElement(App));
    const bar = resizer();

    fireEvent.keyDown(bar, { key: 'ArrowRight' });
    expect(chatWidthVar()).toBe(`${CHAT_WIDTH_DEFAULT + 16}px`);
    expect(window.localStorage.getItem(CHAT_WIDTH_STORAGE_KEY)).toBe(String(CHAT_WIDTH_DEFAULT + 16));

    fireEvent.keyDown(bar, { key: 'ArrowLeft' });
    expect(chatWidthVar()).toBe(`${CHAT_WIDTH_DEFAULT}px`);
  });

  it('宽度被 clamp 在 320–640：Home 到最小，End 到最大', () => {
    render(createElement(App));
    const bar = resizer();

    fireEvent.keyDown(bar, { key: 'Home' });
    expect(chatWidthVar()).toBe(`${CHAT_WIDTH_MIN}px`);
    // 已经在最小，再 ← 不再变小。
    fireEvent.keyDown(bar, { key: 'ArrowLeft' });
    expect(chatWidthVar()).toBe(`${CHAT_WIDTH_MIN}px`);

    fireEvent.keyDown(bar, { key: 'End' });
    expect(chatWidthVar()).toBe(`${CHAT_WIDTH_MAX}px`);
    // 已经在最大，再 → 不再变大。
    fireEvent.keyDown(bar, { key: 'ArrowRight' });
    expect(chatWidthVar()).toBe(`${CHAT_WIDTH_MAX}px`);
  });

  it('双击分隔条复位到默认 380px 并写入 localStorage', () => {
    window.localStorage.setItem(CHAT_WIDTH_STORAGE_KEY, '600');
    render(createElement(App));
    expect(chatWidthVar()).toBe('600px');

    fireEvent.doubleClick(resizer());
    expect(chatWidthVar()).toBe(`${CHAT_WIDTH_DEFAULT}px`);
    expect(window.localStorage.getItem(CHAT_WIDTH_STORAGE_KEY)).toBe(String(CHAT_WIDTH_DEFAULT));
  });

  it('对话列可整体收起：列宽回 0，记住的宽度保留，再展开恢复', () => {
    render(createElement(App));
    expect(chatColumn().classList.contains('chat-column--collapsed')).toBe(false);

    const collapseButton = screen.getByRole('button', { name: '收起对话面板' });
    fireEvent.click(collapseButton);

    expect(chatColumn().classList.contains('chat-column--collapsed')).toBe(true);
    // 列宽回 0，但记住的宽度仍在 localStorage（不是 0）。
    expect(chatWidthVar()).toBe('0px');
    expect(window.localStorage.getItem(CHAT_WIDTH_STORAGE_KEY)).toBe(String(CHAT_WIDTH_DEFAULT));

    // 点分隔条（非拖动）展开，恢复到记住的宽度。
    fireEvent.click(resizer());
    expect(chatColumn().classList.contains('chat-column--collapsed')).toBe(false);
    expect(chatWidthVar()).toBe(`${CHAT_WIDTH_DEFAULT}px`);
  });

  it('图层列可折叠成纵向把手，再点把手展开', () => {
    render(createElement(App));
    expect(document.querySelector('.layer-collapse-handle')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '收起图层面板' }));
    expect(layerColumn().classList.contains('layer-column--collapsed')).toBe(true);
    expect(document.querySelector('.workspace--layers-collapsed')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '展开图层面板' }));
    expect(layerColumn().classList.contains('layer-column--collapsed')).toBe(false);
    expect(document.querySelector('.workspace--layers-collapsed')).toBeNull();
  });
});

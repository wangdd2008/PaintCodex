// @vitest-environment jsdom
// 回归：对话列收起后必须留下一个可见的展开把手。
//
// 症状：点「收起对话面板」后整列 display:none，界面上只剩图层列右缘那条
// 6px、透明的拖拽条（光标没移上去之前看不见）。用户找不到回来的入口，
// 只能刷新页面——而刷新会清空会话记录（UX-24：对话是会话态）。
// 图层列收起时是 28px 把手 + 「图层」竖排标签，对话列应当对齐同一套语义。
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/App';

// jsdom 没有 canvas 2d 上下文，Fabric 无法真实挂载；本用例只关心外壳布局。
vi.mock('../src/features/canvas/CanvasStage', () => ({
  CanvasStage: () => null,
}));

function chatColumn(): HTMLElement {
  const el = document.querySelector<HTMLElement>('.chat-column');
  if (!el) {
    throw new Error('找不到对话列 .chat-column');
  }
  return el;
}

describe('对话列收起后的展开把手（票 ②01 回归）', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.style.removeProperty('--chat-width');
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

  it('收起后留一条带「展开对话面板」标签的把手，点它恢复面板', () => {
    render(createElement(App));

    fireEvent.click(screen.getByRole('button', { name: '收起对话面板' }));
    expect(chatColumn().classList.contains('chat-column--collapsed')).toBe(true);

    // 收起态必须有一个可聚焦、有名字的展开控件，而不是只剩一条隐形拖拽条。
    const handle = screen.getByRole('button', { name: '展开对话面板' });
    fireEvent.click(handle);

    expect(chatColumn().classList.contains('chat-column--collapsed')).toBe(false);
    expect(screen.queryByPlaceholderText('描述你想画的内容…')).not.toBeNull();
  });

  it('把手挂在对话列上，收起时列宽不再是 0', () => {
    render(createElement(App));

    fireEvent.click(screen.getByRole('button', { name: '收起对话面板' }));

    // 列本身仍在网格里占位（28px 竖条），否则把手无处可放。
    expect(document.querySelector('.workspace--chat-collapsed')).not.toBeNull();
    expect(chatColumn().querySelector('.chat-collapse-handle')).not.toBeNull();
  });
});

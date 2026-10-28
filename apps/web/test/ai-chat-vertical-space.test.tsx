// @vitest-environment jsdom
import type { CanvasDocument } from '@paintcodex/protocol';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiChatPanel } from '../src/features/ai-chat/AiChatPanel';
import { useCanvasStore } from '../src/services/canvas-store';

const testDir = dirname(fileURLToPath(import.meta.url));

function readCss(relativePath: string): string {
  return readFileSync(resolve(testDir, relativePath), 'utf8');
}

const rawAiChatCss = readCss('../src/features/ai-chat/ai-chat.css');

/**
 * jsdom 算不了布局，对话区的几何契约钉在样式表上：
 * 消息区吃剩余高度、去掉 280px 硬顶，气泡宽度只受 88% 比例约束。
 */
function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));

  if (!match?.[1]) {
    throw new Error(`样式文件里找不到规则: ${selector}`);
  }

  return match[1];
}

describe('对话垂直空间 CSS 契约', () => {
  it('消息区吃掉剩余高度，不再被 280px 硬顶', () => {
    const messages = ruleBody(rawAiChatCss, '.ai-chat__messages');

    expect(messages).toMatch(/flex:\s*1/);
    expect(messages).not.toMatch(/max-height:\s*280px/);
    expect(messages).toMatch(/max-height:\s*none/);
    expect(messages).toMatch(/min-height:\s*48px/);
    expect(messages).toMatch(/overflow-y:\s*(auto|scroll)/);
  });

  it('对话 body 吃掉剩余高度（flex:1 + min-height:0）', () => {
    const body = ruleBody(rawAiChatCss, '.ai-chat__body');

    expect(body).toMatch(/flex:\s*1/);
    expect(body).toMatch(/min-height:\s*0/);
  });

  it('气泡只受 88% 比例约束，输入框保持三行高与纵向拉伸', () => {
    const message = ruleBody(rawAiChatCss, '.ai-chat__message');
    expect(message).toMatch(/max-width:\s*88%/);

    const input = ruleBody(rawAiChatCss, '.ai-chat__input');
    expect(input).toMatch(/resize:\s*vertical/);
  });
});

function readyCanvas(): CanvasDocument {
  return {
    id: 'canvas-1',
    name: '测试画布',
    width: 1920,
    height: 1080,
    backgroundColor: '#ffffff',
    revision: 1,
    createdAt: 0,
    updatedAt: 0,
    history: { canUndo: false, canRedo: false },
    layers: [],
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useCanvasStore.setState({
    canvas: null,
    status: 'idle',
    error: null,
    requestedCanvasId: null,
    saving: false,
    activeLayerId: null,
  });
});

beforeEach(() => {
  // jsdom does not implement element scrolling.
  Object.defineProperty(Element.prototype, 'scrollTo', {
    configurable: true,
    value: () => undefined,
  });
});

describe('AiChatPanel 布局接缝', () => {
  it('渲染出 body / messages 两层容器，输入框 rows=3', () => {
    useCanvasStore.setState({
      canvas: readyCanvas(),
      status: 'ready',
      error: null,
      requestedCanvasId: 'canvas-1',
      saving: false,
      activeLayerId: null,
    });

    render(<AiChatPanel />);

    expect(document.querySelector('.ai-chat__body')).not.toBeNull();
    expect(document.querySelector('.ai-chat__messages')).not.toBeNull();
    const input = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(input.rows).toBe(3);
  });
});

// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CanvasDocument } from '@paintcodex/protocol';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/App';
import { useCanvasStore } from '../src/services/canvas-store';
import { useViewportStore } from '../src/services/viewport-store';

const { downloadSpy } = vi.hoisted(() => ({ downloadSpy: vi.fn() }));

// The status bar is the subject here; Fabric and SSE are covered elsewhere.
vi.mock('../src/features/canvas/CanvasStage', () => ({
  CanvasStage: () => null,
}));
vi.mock('../src/features/ai-chat/AiChatPanel', () => ({
  AiChatPanel: () => null,
}));
vi.mock('../src/runtime/paint-sse', () => ({
  subscribeToCanvas: () => () => undefined,
}));
vi.mock('../src/services/json-export', () => ({
  canvasJsonFilename: (name: string) => `${name}.json`,
  downloadCanvasJson: downloadSpy,
}));

const testDir = dirname(fileURLToPath(import.meta.url));

function canvasDocument(): CanvasDocument {
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

function resetStores(): void {
  useCanvasStore.setState({
    canvas: null,
    status: 'idle',
    error: null,
    requestedCanvasId: null,
    saving: false,
    saveState: 'idle',
    lastSavedAt: null,
    saveError: null,
    unsavedStrokes: 0,
    canvasAlert: null,
    canvasRetry: null,
    activeLayerId: null,
  });
  useViewportStore.setState({ zoomPercent: null });
}

beforeEach(() => {
  resetStores();
  downloadSpy.mockClear();
  window.localStorage.clear();
  window.history.replaceState({}, '', '/');
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('状态栏', () => {
  it('名称/尺寸/比例/工具/保存状态各出现一次，比例是真实缩放宽', () => {
    useCanvasStore.setState({
      canvas: canvasDocument(),
      status: 'ready',
      saveState: 'saved',
      lastSavedAt: Date.now(),
    });
    useViewportStore.setState({ zoomPercent: 44.7 });

    const { container } = render(<App />);
    const statusText = container.querySelector('.status-bar')?.textContent ?? '';

    expect(statusText).toContain('1920 × 1080');
    expect(statusText).toContain('44.7%');
    expect(statusText).toContain('画笔');
    expect(statusText).toContain('已保存 · 刚刚');

    expect((statusText.match(/1920 × 1080/g) ?? []).length).toBe(1);
    expect((statusText.match(/44\.7%/g) ?? []).length).toBe(1);
    expect((statusText.match(/画笔/g) ?? []).length).toBe(1);
    expect((statusText.match(/已保存/g) ?? []).length).toBe(1);

    // The canvas name appears once (menu bar), never duplicated in the canvas.
    expect(container.querySelectorAll('.document-name')).toHaveLength(1);
    expect(container.querySelector('.document-name')?.textContent).toBe('测试画布');
    expect(container.querySelector('.canvas-hint')).toBeNull();
  });
});

describe('自动下载已移除', () => {
  it('App 源码里没有 30 秒定时下载', () => {
    const source = readFileSync(resolve(testDir, '../src/app/App.tsx'), 'utf8');

    expect(source).not.toMatch(/setInterval/);
    expect(source).not.toMatch(/30_000/);
    expect(source).not.toMatch(/Auto-save/);
  });

  it('空闲 60 秒不会调用下载函数', async () => {
    useCanvasStore.setState({ canvas: canvasDocument(), status: 'ready' });
    vi.useFakeTimers();

    render(<App />);
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });

    expect(downloadSpy).not.toHaveBeenCalled();
  });
});

// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  formatSavedAt,
  SaveStatus,
  saveStatusText,
} from '../src/features/status-bar/SaveStatus';
import { useCanvasStore } from '../src/services/canvas-store';

function resetStore(): void {
  useCanvasStore.setState({
    saveState: 'idle',
    lastSavedAt: null,
    saveError: null,
    unsavedStrokes: 0,
    canvasAlert: null,
    canvasRetry: null,
    saving: false,
  });
}

beforeEach(() => {
  resetStore();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('相对时间文案', () => {
  it('≤15 秒「刚刚」，16–59 秒「N 秒前」，≥60 秒「N 分钟前」', () => {
    const now = 1_000_000;

    expect(formatSavedAt(now - 0, now)).toBe('刚刚');
    expect(formatSavedAt(now - 15_000, now)).toBe('刚刚');
    expect(formatSavedAt(now - 16_000, now)).toBe('16 秒前');
    expect(formatSavedAt(now - 59_000, now)).toBe('59 秒前');
    expect(formatSavedAt(now - 60_000, now)).toBe('1 分钟前');
    expect(formatSavedAt(now - 125_000, now)).toBe('2 分钟前');
  });

  it('三种保存状态各有唯一文案', () => {
    const now = 1_000_000;

    expect(saveStatusText('saving', null, now)).toBe('保存中…');
    expect(saveStatusText('saved', now, now)).toBe('已保存 · 刚刚');
    expect(saveStatusText('error', null, now)).toBe('保存失败 · 重试');
  });
});

describe('状态栏保存状态', () => {
  it('每秒刷新相对时间', () => {
    vi.useFakeTimers();
    act(() => {
      useCanvasStore.setState({ saveState: 'saved', lastSavedAt: Date.now() });
    });

    render(<SaveStatus />);
    expect(screen.getByText('已保存 · 刚刚')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(16_000);
    });
    expect(screen.getByText('已保存 · 16 秒前')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText('已保存 · 1 分钟前')).toBeTruthy();
  });

  it('保存中显示「保存中…」', () => {
    act(() => {
      useCanvasStore.setState({ saveState: 'saving' });
    });

    render(<SaveStatus />);
    expect(screen.getByText('保存中…')).toBeTruthy();
  });

  it('保存失败是可点击的重试按钮', async () => {
    const retry = vi.fn(async () => undefined);
    act(() => {
      useCanvasStore.setState({
        saveState: 'error',
        canvasAlert: '这一笔未保存',
        canvasRetry: retry,
      });
    });

    render(<SaveStatus />);
    fireEvent.click(screen.getByRole('button', { name: '保存失败 · 重试' }));

    await waitFor(() => expect(retry).toHaveBeenCalledTimes(1));
  });
});

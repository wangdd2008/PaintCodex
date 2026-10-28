// @vitest-environment jsdom
import type { CanvasSummary } from '@paintcodex/protocol';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CanvasLibraryPage } from '../src/features/canvas-library/CanvasLibraryPage';

function summary(overrides: Partial<CanvasSummary> = {}): CanvasSummary {
  return {
    id: 'canvas-a',
    name: '红色练习',
    width: 1920,
    height: 1080,
    backgroundColor: '#ffffff',
    layerCount: 2,
    revision: 3,
    hasThumbnail: false,
    thumbnailRevision: null,
    createdAt: 0,
    updatedAt: Date.now() - 60_000,
    ...overrides,
  };
}

function listPage(items: CanvasSummary[], total = items.length): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ items, total, limit: 50, offset: 0 }),
  } as unknown as Response;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('画布库空态', () => {
  it('空库显示主 CTA「新建画布」，点击交给外层新建流程', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain('/paint/canvas?');
      return listPage([]);
    });
    vi.stubGlobal('fetch', fetchMock);

    const onCreate = vi.fn();
    render(<CanvasLibraryPage onOpenCanvas={vi.fn()} onCreateCanvas={onCreate} />);

    const cta = await screen.findByRole('button', { name: '新建画布' });
    fireEvent.click(cta);

    expect(onCreate).toHaveBeenCalledTimes(1);
  });
});

describe('画布库卡片', () => {
  const cardA = summary({ id: 'canvas-a', name: '红色练习', layerCount: 2 });
  const cardB = summary({
    id: 'canvas-b',
    name: '夜景',
    width: 1280,
    height: 720,
    layerCount: 0,
    hasThumbnail: true,
  });

  function stubList() {
    return vi.fn(async (input: RequestInfo | URL) => listPage([cardA, cardB]));
  }

  it('每张卡片是一个指向画布的真实链接，并显示名称、尺寸·层数与更新时间', async () => {
    vi.stubGlobal('fetch', stubList());
    render(<CanvasLibraryPage onOpenCanvas={vi.fn()} onCreateCanvas={vi.fn()} />);

    const linkA = await screen.findByRole('link', { name: /红色练习/ });
    expect(linkA.getAttribute('href')).toBe('/?canvasId=canvas-a');

    expect(screen.getByText('夜景')).toBeTruthy();
    // 尺寸 × 层数
    expect(screen.getByText(/1280 × 720/)).toBeTruthy();
    expect(screen.getByText(/0 层/)).toBeTruthy();
    // 相对更新时间只是存在性断言，不测措辞。
    expect(screen.getAllByText(/分钟前|小时前|天前|刚刚/).length).toBeGreaterThan(0);
  });

  it('点卡片调用外层打开流程（不依赖真实跳转）', async () => {
    vi.stubGlobal('fetch', stubList());
    const onOpen = vi.fn();
    render(<CanvasLibraryPage onOpenCanvas={onOpen} onCreateCanvas={vi.fn()} />);

    const link = await screen.findByRole('link', { name: /红色练习/ });
    fireEvent.click(link);

    expect(onOpen).toHaveBeenCalledWith('canvas-a');
  });
});

describe('画布库分页', () => {
  it('首页超过 50 张时显示「加载更多」，点击后追加下一页', async () => {
    const firstPage = Array.from({ length: 50 }, (_, i) =>
      summary({ id: `canvas-${i}`, name: `练习 ${i}` }),
    );
    const secondPage = [summary({ id: 'canvas-50', name: '最后一张' })];

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('offset=50')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: secondPage, total: 51, limit: 50, offset: 50 }),
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ items: firstPage, total: 51, limit: 50, offset: 0 }),
      } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<CanvasLibraryPage onOpenCanvas={vi.fn()} onCreateCanvas={vi.fn()} />);

    const more = await screen.findByRole('button', { name: '加载更多' });
    fireEvent.click(more);

    await screen.findByText('最后一张');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]![0])).toContain('offset=50');
    // 全部加载完后按钮消失。
    expect(screen.queryByRole('button', { name: '加载更多' })).toBeNull();
  });
});

describe('画布库删除', () => {
  const cardA = summary({ id: 'canvas-a', name: '红色练习' });

  it('删除二次确认里含画布名与「不可恢复」；取消不发任何请求', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => listPage([cardA]));
    vi.stubGlobal('fetch', fetchMock);
    render(<CanvasLibraryPage onOpenCanvas={vi.fn()} onCreateCanvas={vi.fn()} />);

    await screen.findByRole('link', { name: /红色练习/ });
    fetchMock.mockClear();

    fireEvent.click(screen.getByRole('button', { name: '删除画布「红色练习」' }));

    const dialog = screen.getByRole('alertdialog');
    expect(dialog.textContent).toContain('红色练习');
    expect(dialog.textContent).toContain('不可恢复');

    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    expect(screen.queryByRole('alertdialog')).toBeNull();
    // 取消后卡片还在，且一次 DELETE 都没发。
    expect(screen.getByRole('link', { name: /红色练习/ })).toBeTruthy();
    expect(
      fetchMock.mock.calls.filter(
        (call) => (call[1] as RequestInit | undefined)?.method === 'DELETE',
      ),
    ).toHaveLength(0);
  });
});

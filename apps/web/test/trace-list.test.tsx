// @vitest-environment jsdom
import type { TraceSummary } from '@paintcodex/protocol';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TraceList } from '../src/features/monitor/trace-list';

// 展开区现在渲染 TraceView（③05），它会调 fetchTrace——这里 mock 掉。
vi.mock('../src/features/monitor/monitor-api', () => ({
  fetchTrace: vi.fn().mockResolvedValue({ traceId: 'trace-abcdefgh', roots: [] }),
}));

afterEach(cleanup);

function makeTrace(overrides: Partial<TraceSummary> = {}): TraceSummary {
  return {
    traceId: 'trace-abcdefgh',
    startedAt: Date.UTC(2026, 9, 29, 10, 0, 0),
    endedAt: Date.UTC(2026, 9, 29, 10, 0, 1, 500),
    spanCount: 4,
    errorCount: 1,
    components: ['browser', 'daemon', 'codex'],
    rootMessage: 'http_request',
    requestPath: '/paint/canvas',
    canvasId: null,
    actor: 'user',
    ...overrides,
  };
}

function renderList(items: readonly TraceSummary[], props: Partial<Parameters<typeof TraceList>[0]> = {}) {
  return render(
    <TraceList
      items={items}
      loading={false}
      error={null}
      expandedTraceId={null}
      onToggle={() => {}}
      onRetry={() => {}}
      {...props}
    />,
  );
}

describe('TraceList', () => {
  it('renders one row per trace with the six columns', () => {
    renderList([makeTrace()]);

    expect(screen.getByText('http_request')).toBeTruthy();
    expect(screen.getByText('/paint/canvas')).toBeTruthy();
    // 组件路径来自 components，渲染成中文箭头链
    expect(screen.getByText('浏览器 → Daemon → Codex')).toBeTruthy();
    expect(screen.getByText('4')).toBeTruthy(); // 节点数
    expect(screen.getByText('1')).toBeTruthy(); // 错误数
    expect(screen.getByText('1.50s')).toBeTruthy(); // 总耗时
  });

  it('renders an empty component path as a dash', () => {
    renderList([makeTrace({ traceId: 't-2', components: [] })]);

    expect(screen.getByText('—')).toBeTruthy();
  });

  it('shows a loading state', () => {
    renderList([], { loading: true });

    expect(screen.getByText('加载追踪中…')).toBeTruthy();
  });

  it('shows an empty state', () => {
    renderList([]);

    expect(screen.getByText(/暂无追踪/)).toBeTruthy();
  });

  it('shows the error state with a working retry button', () => {
    const onRetry = vi.fn();
    renderList([], { error: '网络断开', onRetry });

    expect(screen.getByText(/网络断开/)).toBeTruthy();
    fireEvent.click(screen.getByText('重试'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('expands the timeline placeholder under the clicked row', () => {
    const onToggle = vi.fn();
    renderList([makeTrace()], { onToggle });

    fireEvent.click(screen.getByText('http_request'));
    expect(onToggle).toHaveBeenCalledWith('trace-abcdefgh');

    // 展开区已接线到 ③05 的 TraceView（接线点 B）：渲染追踪详情区。
    renderList([makeTrace()], { expandedTraceId: 'trace-abcdefgh' });
    expect(screen.getByRole('heading', { name: '追踪' })).toBeTruthy();
  });
});

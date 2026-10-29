// @vitest-environment jsdom
import type { AgentLog, AgentTrace, AgentTraceNode } from '@paintcodex/protocol';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TraceView } from '../src/features/monitor/TraceView';
import { ApiError } from '../src/services/api';

// 隔离网络：本组件测试只看视图切换与交互，不真发请求。
vi.mock('../src/features/monitor/monitor-api', () => ({
  fetchTrace: vi.fn(),
}));

import { fetchTrace } from '../src/features/monitor/monitor-api';

const fetchTraceMock = vi.mocked(fetchTrace);

function makeLog(id: number, overrides: Partial<AgentLog> = {}): AgentLog {
  return {
    id,
    traceId: 'trace-1',
    spanId: `span-${id}`,
    parentId: null,
    timestamp: 1_000 + id,
    level: 'info',
    category: 'system',
    message: `event-${id}`,
    payload: null,
    durationMs: null,
    error: null,
    canvasId: null,
    revision: null,
    actor: null,
    source: null,
    target: null,
    ...overrides,
  };
}

function node(log: AgentLog, children: AgentTraceNode[] = []): AgentTraceNode {
  return { log, children };
}

function sampleTrace(): AgentTrace {
  const http = makeLog(1, {
    category: 'http',
    message: 'http_request',
    source: 'browser',
    target: 'daemon',
    payload: { method: 'GET', path: '/monitor/traces' },
  });
  const turn = makeLog(2, {
    category: 'ai-chat',
    message: 'turn_start',
    source: 'daemon',
    target: 'codex',
    durationMs: 500,
  });
  const sys = makeLog(3, { category: 'system', message: 'boot', source: null, target: null });
  return { traceId: 'trace-1', roots: [node(http, [node(turn)]), node(sys)] };
}

afterEach(() => {
  cleanup();
  fetchTraceMock.mockReset();
});

function renderView(traceId: string | null = 'trace-1') {
  return render(<TraceView traceId={traceId} onClose={() => undefined} />);
}

describe('TraceView 追踪内部视图', () => {
  it('默认渲染时序图：箭头 + 内部圆点，纵轴用相对时间', async () => {
    fetchTraceMock.mockResolvedValue(sampleTrace());
    renderView();

    // 先出现加载文案，再渲染出两种记录。
    expect(screen.getByText('加载追踪中…')).toBeTruthy();
    await waitFor(() => expect(screen.getAllByTestId('seq-arrow')).toHaveLength(2));
    expect(screen.getAllByTestId('seq-dot')).toHaveLength(1);

    // 纵轴相对时间：首条 +0ms。
    expect(screen.getByText('+0ms')).toBeTruthy();
  });

  it('点击箭头后下方 LogDetail 渲染该记录的 payload', async () => {
    fetchTraceMock.mockResolvedValue(sampleTrace());
    renderView();

    await waitFor(() => expect(screen.getAllByTestId('seq-arrow')).toHaveLength(2));

    const arrows = screen.getAllByTestId('seq-arrow');
    const firstArrow = arrows[0];
    if (firstArrow === undefined) {
      throw new Error('missing first arrow');
    }
    fireEvent.click(firstArrow);

    // ③04 正式 LogDetail：已知键渲染成「标签：值」dl，不再用 message 头。
    await waitFor(() => {
      const fields = document.querySelector('.log-detail__fields');
      expect(fields?.textContent).toContain('方法');
      expect(fields?.textContent).toContain('GET');
      expect(fields?.textContent).toContain('路径');
      expect(fields?.textContent).toContain('/monitor/traces');
    });
  });

  it('开关切到层级树：保留父子结构，每行带方向列', async () => {
    fetchTraceMock.mockResolvedValue(sampleTrace());
    renderView();

    await waitFor(() => expect(screen.getAllByTestId('seq-arrow')).toHaveLength(2));

    fireEvent.click(screen.getByRole('button', { name: '层级树' }));

    // 三行记录；有方向的写「源 → 目标」，内部写「内部」。
    const rows = screen.getAllByTestId('trace-tree-row');
    expect(rows).toHaveLength(3);
    expect(screen.getByText('浏览器 → Daemon')).toBeTruthy();
    expect(screen.getByText('Daemon → Codex')).toBeTruthy();
    expect(screen.getByText('内部')).toBeTruthy();
  });

  it('层级树里点一行也能显示明细', async () => {
    fetchTraceMock.mockResolvedValue(sampleTrace());
    renderView();
    await waitFor(() => expect(screen.getAllByTestId('seq-arrow')).toHaveLength(2));

    fireEvent.click(screen.getByRole('button', { name: '层级树' }));
    fireEvent.click(screen.getByText('turn_start'));

    // 选中后占位提示消失；turn_start 的 payload 为 null，正式 LogDetail 显示空文案。
    await waitFor(() =>
      expect(
        screen.queryByText('点击时序图或层级树中的任一记录，在此查看其明细。'),
      ).toBeNull(),
    );
    expect(
      screen.getByText('无 payload 明细', { selector: '.log-detail__empty' }),
    ).toBeTruthy();
  });

  it('追踪加载失败时显示错误文案，刷新按钮保留', async () => {
    fetchTraceMock.mockRejectedValue(new ApiError('网络挂了', 500, 'boom'));
    renderView();

    await waitFor(() => expect(screen.getByText(/网络挂了/)).toBeTruthy());
    expect(screen.getByRole('button', { name: '刷新' })).toBeTruthy();
  });

  it('追踪为空时显示空文案', async () => {
    fetchTraceMock.mockResolvedValue({ traceId: 'trace-1', roots: [] });
    renderView();

    await waitFor(() =>
      expect(screen.getByText('此追踪没有记录任何节点。')).toBeTruthy(),
    );
  });
});

// @vitest-environment jsdom
import type { AgentLog } from '@paintcodex/protocol';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RawLogList } from '../src/features/monitor/raw-log-list';

afterEach(cleanup);

function makeLog(id: number, overrides: Partial<AgentLog> = {}): AgentLog {
  return {
    id,
    traceId: null,
    spanId: null,
    parentId: null,
    timestamp: Date.UTC(2026, 9, 29, 10, 0, 0),
    level: 'info',
    category: 'system',
    message: 'system_startup',
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

describe('RawLogList', () => {
  it('renders the direction column from source/target', () => {
    render(
      <RawLogList
        logs={[
          makeLog(1, { source: 'browser', target: 'daemon' }),
          makeLog(2, {}),
        ]}
        expandedLogId={null}
        onToggleLog={() => {}}
      />,
    );

    expect(screen.getByText('浏览器 → Daemon')).toBeTruthy();
    // 两端皆 NULL 的内部事件显示「内部」
    expect(screen.getByText('内部')).toBeTruthy();
  });

  it('renders an invalid timestamp as a dash instead of crashing', () => {
    render(
      <RawLogList
        logs={[makeLog(1, { timestamp: Number.NaN })]}
        expandedLogId={null}
        onToggleLog={() => {}}
      />,
    );

    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('expands the payload detail on row click', () => {
    const onToggleLog = vi.fn();
    render(
      <RawLogList
        logs={[
          makeLog(1, {
            category: 'http',
            message: 'http_request',
            payload: { method: 'GET', path: '/health', statusCode: 200 },
          }),
        ]}
        expandedLogId={1}
        onToggleLog={onToggleLog}
      />,
    );

    fireEvent.click(screen.getByText('http_request'));
    expect(onToggleLog).toHaveBeenCalledWith(1);

    // 展开行渲染 LogDetail：已知键出现在明细里
    expect(screen.getByText('方法')).toBeTruthy();
    expect(screen.getByText('GET')).toBeTruthy();
  });
});

// @vitest-environment jsdom
import type { MonitorStats } from '@paintcodex/protocol';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StatsPanel } from '../src/features/monitor/StatsPanel';

afterEach(cleanup);

function makeStats(overrides: Partial<MonitorStats> = {}): MonitorStats {
  return {
    windowMs: 300_000,
    totalLogs: 24,
    errorCount: 1,
    errorRate: 2 / 24,
    requestCount: 24,
    requestsPerSecond: 0.08,
    avgDurationMs: 12,
    httpFailureCount: 0,
    httpConflictCount: 2,
    aiChatCount: 1,
    aiChatSuccessCount: 1,
    aiChatAbortedCount: 1,
    aiChatSuccessRate: null,
    categoryCounts: [
      { category: 'http', count: 24, errorCount: 0 },
      { category: 'ai-chat', count: 2, errorCount: 1 },
    ],
    ...overrides,
  };
}

function statCard(label: string): HTMLElement {
  const card = screen.getByText(label).closest('.stat-card');

  if (card === null) {
    throw new Error(`missing stat card: ${label}`);
  }

  return card as HTMLElement;
}

describe('StatsPanel', () => {
  it('renders the HTTP error rate with its numerator and denominator', () => {
    render(<StatsPanel stats={makeStats()} error={null} />);

    const card = within(statCard('HTTP 错误率'));

    expect(card.getByText('8.3%')).toBeTruthy();
    expect(card.getByText('0 失败 · 2 冲突 / 24 请求')).toBeTruthy();
  });

  it('shows a dash instead of a percentage when there are no HTTP requests', () => {
    render(
      <StatsPanel
        stats={makeStats({
          requestCount: 0,
          errorRate: null,
          requestsPerSecond: 0,
          httpFailureCount: 0,
          httpConflictCount: 0,
        })}
        error={null}
      />,
    );

    const card = within(statCard('HTTP 错误率'));

    expect(card.getByText('—')).toBeTruthy();
    expect(card.queryByText('0.0%')).toBeNull();
    expect(card.getByText('0 失败 · 0 冲突 / 0 请求')).toBeTruthy();
  });

  it('shows every error next to the category bars that prove it', () => {
    render(<StatsPanel stats={makeStats()} error={null} />);

    const card = within(statCard('全部错误'));

    expect(card.getByText('1')).toBeTruthy();
    expect(card.getByText('ai-chat 1')).toBeTruthy();

    const bar = screen.getByText('ai-chat').closest('.category-bar');

    if (bar === null) {
      throw new Error('missing ai-chat category bar');
    }

    expect(within(bar as HTMLElement).getByText(/1 错误/)).toBeTruthy();
  });

  it('excludes cancellations from the AI success rate and shows them beside it', () => {
    render(<StatsPanel stats={makeStats()} error={null} />);

    const card = within(statCard('AI 成功率'));

    expect(card.getByText('—')).toBeTruthy();
    expect(card.getByText('1/1 次对话 · 1 取消')).toBeTruthy();
  });

  it('shows a definite AI rate only once five chats completed', () => {
    render(
      <StatsPanel
        stats={makeStats({
          aiChatCount: 5,
          aiChatSuccessCount: 5,
          aiChatAbortedCount: 0,
          aiChatSuccessRate: 1,
        })}
        error={null}
      />,
    );

    const card = within(statCard('AI 成功率'));

    expect(card.getByText('100.0%')).toBeTruthy();
    expect(card.getByText('5/5 次对话 · 0 取消')).toBeTruthy();
  });
});

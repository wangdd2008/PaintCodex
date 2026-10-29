import type { AgentLog } from '@paintcodex/protocol';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOG_FILTERS,
  DEFAULT_LOG_SORT,
  filterLogs,
  formatAiChatHint,
  formatDuration,
  formatErrorBreakdown,
  formatHttpErrorHint,
  formatPercent,
  formatTimestamp,
  MAX_LOG_BUFFER,
  mergeLogs,
  rangeToSince,
  shortenId,
  sortLogs,
} from '../src/features/monitor/monitor-format';

function makeLog(id: number, overrides: Partial<AgentLog> = {}): AgentLog {
  return {
    id,
    traceId: null,
    spanId: null,
    parentId: null,
    timestamp: id,
    level: 'info',
    category: 'system',
    message: `log ${id}`,
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

describe('formatDuration', () => {
  it('renders missing and invalid durations as a dash', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(undefined)).toBe('—');
    expect(formatDuration(Number.NaN)).toBe('—');
    expect(formatDuration(-1)).toBe('—');
  });

  it('renders sub-second durations in whole milliseconds', () => {
    expect(formatDuration(0)).toBe('0ms');
    expect(formatDuration(12.6)).toBe('13ms');
    expect(formatDuration(999)).toBe('999ms');
  });

  it('renders seconds with two decimals below ten seconds', () => {
    expect(formatDuration(1000)).toBe('1.00s');
    expect(formatDuration(1234)).toBe('1.23s');
    expect(formatDuration(9876)).toBe('9.88s');
  });

  it('renders one decimal above ten seconds', () => {
    expect(formatDuration(12345)).toBe('12.3s');
    expect(formatDuration(60_000)).toBe('60.0s');
  });
});

describe('formatTimestamp', () => {
  it('renders hours, minutes, seconds and milliseconds', () => {
    expect(formatTimestamp(Date.UTC(2020, 0, 1, 12, 34, 56, 789))).toMatch(
      /^\d{2}:\d{2}:\d{2}\.789$/,
    );
  });

  it('pads single-digit components', () => {
    expect(formatTimestamp(Date.UTC(2020, 0, 1, 1, 2, 3, 4))).toMatch(
      /^\d{2}:\d{2}:\d{2}\.004$/,
    );
  });

  it('renders invalid timestamps as a dash', () => {
    expect(formatTimestamp(Number.NaN)).toBe('—');
    expect(formatTimestamp(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

describe('formatPercent', () => {
  it('renders a ratio as a percentage with one decimal', () => {
    expect(formatPercent(0)).toBe('0.0%');
    expect(formatPercent(0.1234)).toBe('12.3%');
    expect(formatPercent(1)).toBe('100.0%');
  });

  it('renders invalid or unknown ratios as a dash', () => {
    expect(formatPercent(Number.NaN)).toBe('—');
    expect(formatPercent(null)).toBe('—');
  });
});

describe('formatHttpErrorHint', () => {
  it('writes the failure and conflict numerators over the request denominator', () => {
    expect(
      formatHttpErrorHint({
        httpFailureCount: 0,
        httpConflictCount: 2,
        requestCount: 24,
      }),
    ).toBe('0 失败 · 2 冲突 / 24 请求');
  });

  it('keeps a zero denominator explicit', () => {
    expect(
      formatHttpErrorHint({
        httpFailureCount: 0,
        httpConflictCount: 0,
        requestCount: 0,
      }),
    ).toBe('0 失败 · 0 冲突 / 0 请求');
  });
});

describe('formatAiChatHint', () => {
  it('shows successes over non-aborted chats plus the cancellation count', () => {
    expect(
      formatAiChatHint({
        aiChatSuccessCount: 1,
        aiChatCount: 1,
        aiChatAbortedCount: 1,
      }),
    ).toBe('1/1 次对话 · 1 取消');
  });
});

describe('formatErrorBreakdown', () => {
  it('lists only categories that reported errors', () => {
    expect(
      formatErrorBreakdown([
        { category: 'http', count: 24, errorCount: 0 },
        { category: 'ai-chat', count: 2, errorCount: 1 },
        { category: 'system', count: 3, errorCount: 0 },
      ]),
    ).toBe('ai-chat 1');
  });

  it('orders categories by error count and joins them', () => {
    expect(
      formatErrorBreakdown([
        { category: 'http', count: 24, errorCount: 1 },
        { category: 'ai-chat', count: 2, errorCount: 3 },
      ]),
    ).toBe('ai-chat 3 · http 1');
  });

  it('returns null when nothing errored', () => {
    expect(
      formatErrorBreakdown([{ category: 'http', count: 24, errorCount: 0 }]),
    ).toBeNull();
  });
});

describe('shortenId', () => {
  it('keeps short ids intact', () => {
    expect(shortenId('abc', 8)).toBe('abc');
  });

  it('truncates long ids with an ellipsis', () => {
    expect(shortenId('abcdefghijkl', 8)).toBe('abcdefgh…');
  });
});

describe('filterLogs', () => {
  const now = 1_000_000;
  const logs = [
    makeLog(1, { category: 'http', level: 'error', timestamp: now - 60_000 }),
    makeLog(2, { category: 'http', level: 'info', timestamp: now - 10 * 60_000 }),
    makeLog(3, { category: 'system', level: 'warn', timestamp: now - 40 * 60_000 }),
  ];

  it('returns every log for the default filter', () => {
    expect(filterLogs(logs, DEFAULT_LOG_FILTERS, now).map((log) => log.id)).toEqual([1, 2, 3]);
  });

  it('filters by category', () => {
    const filtered = filterLogs(logs, { ...DEFAULT_LOG_FILTERS, category: 'http' }, now);
    expect(filtered.map((log) => log.id)).toEqual([1, 2]);
  });

  it('filters by level', () => {
    expect(
      filterLogs(logs, { ...DEFAULT_LOG_FILTERS, level: 'error', range: 'all' }, now).map(
        (log) => log.id,
      ),
    ).toEqual([1]);
  });

  it('filters by relative time range', () => {
    expect(filterLogs(logs, { ...DEFAULT_LOG_FILTERS, range: '5m' }, now).map((log) => log.id)).toEqual([
      1,
    ]);
    expect(
      filterLogs(logs, { ...DEFAULT_LOG_FILTERS, range: '15m' }, now).map((log) => log.id),
    ).toEqual([1, 2]);
  });

  it('includes a log exactly on the window boundary', () => {
    const boundary = makeLog(4, { timestamp: now - 5 * 60_000 });
    expect(
      filterLogs([boundary], { ...DEFAULT_LOG_FILTERS, range: '5m' }, now),
    ).toHaveLength(1);
  });
});

describe('rangeToSince', () => {
  const now = 1_000_000;

  it('returns undefined for the all-time range', () => {
    expect(rangeToSince('all', now)).toBeUndefined();
  });

  it('converts each relative range into an absolute timestamp', () => {
    expect(rangeToSince('5m', now)).toBe(now - 5 * 60_000);
    expect(rangeToSince('15m', now)).toBe(now - 15 * 60_000);
    expect(rangeToSince('1h', now)).toBe(now - 60 * 60_000);
  });
});

describe('sortLogs', () => {
  const logs = [
    makeLog(1, { timestamp: 100, durationMs: 50 }),
    makeLog(2, { timestamp: 300, durationMs: null }),
    makeLog(3, { timestamp: 200, durationMs: 10 }),
  ];

  it('sorts by timestamp descending by default', () => {
    expect(sortLogs(logs, DEFAULT_LOG_SORT).map((log) => log.id)).toEqual([2, 3, 1]);
  });

  it('sorts by timestamp ascending', () => {
    expect(
      sortLogs(logs, { field: 'timestamp', direction: 'asc' }).map((log) => log.id),
    ).toEqual([1, 3, 2]);
  });

  it('sorts by duration descending and keeps missing durations last', () => {
    expect(
      sortLogs(logs, { field: 'durationMs', direction: 'desc' }).map((log) => log.id),
    ).toEqual([1, 3, 2]);
  });

  it('sorts by duration ascending and keeps missing durations last', () => {
    expect(
      sortLogs(logs, { field: 'durationMs', direction: 'asc' }).map((log) => log.id),
    ).toEqual([3, 1, 2]);
  });

  it('breaks ties with the newest id first', () => {
    const tied = [makeLog(5, { timestamp: 1 }), makeLog(9, { timestamp: 1 })];
    expect(sortLogs(tied, { field: 'timestamp', direction: 'asc' }).map((log) => log.id)).toEqual([
      9, 5,
    ]);
  });

  it('does not mutate the input array', () => {
    const source = [...logs];
    sortLogs(source, DEFAULT_LOG_SORT);
    expect(source.map((log) => log.id)).toEqual([1, 2, 3]);
  });
});

describe('mergeLogs', () => {
  it('deduplicates by id with the incoming record winning', () => {
    const merged = mergeLogs(
      [makeLog(1, { message: 'old' })],
      [makeLog(1, { message: 'new' }), makeLog(2)],
    );

    expect(merged.map((log) => log.id)).toEqual([2, 1]);
    expect(merged.find((log) => log.id === 1)?.message).toBe('new');
  });

  it('orders by insertion id DESC even when timestamps go backwards', () => {
    // span 完成记录回溯写入开始时间：落库顺序（id）才是逐条视图的排序依据。
    const merged = mergeLogs(
      [],
      [makeLog(1, { timestamp: 5_000 }), makeLog(2, { timestamp: 1_000 })],
    );
    expect(merged.map((log) => log.id)).toEqual([2, 1]);
  });

  it('keeps the live buffer at 200 records', () => {
    expect(MAX_LOG_BUFFER).toBe(200);
  });

  it('caps the buffer at the requested size', () => {
    const incoming = Array.from({ length: 10 }, (_, index) => makeLog(index + 1));
    expect(mergeLogs([], incoming, 4).map((log) => log.id)).toEqual([10, 9, 8, 7]);
  });
});

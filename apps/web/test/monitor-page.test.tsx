// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MonitorPage } from '../src/features/monitor/MonitorPage';

/** MonitorPage 会订阅 `/monitor/events`；jsdom 没有 EventSource。 */
class FakeEventSource {
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;

  addEventListener(): void {}

  close(): void {}
}

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as unknown as Response;
}

const emptyLogPage = { items: [], total: 0, limit: 50, offset: 0 };

const emptyStats = {
  windowMs: 300_000,
  totalLogs: 0,
  errorCount: 0,
  errorRate: null,
  requestCount: 0,
  requestsPerSecond: 0,
  avgDurationMs: 0,
  httpFailureCount: 0,
  httpConflictCount: 0,
  aiChatCount: 0,
  aiChatSuccessCount: 0,
  aiChatAbortedCount: 0,
  aiChatSuccessRate: null,
  categoryCounts: [],
};

const sampleTrace = {
  traceId: 'trace-1',
  startedAt: 0,
  endedAt: 100,
  spanCount: 2,
  errorCount: 0,
  components: ['browser', 'daemon'],
  rootMessage: 'http_request',
  requestPath: '/health',
  canvasId: null,
  actor: null,
};

function routeFetch(routes: Record<string, unknown>): ReturnType<typeof vi.fn> {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);

    for (const [prefix, body] of Object.entries(routes)) {
      if (url.startsWith(prefix)) {
        return jsonResponse(body);
      }
    }

    throw new Error(`unexpected request: ${url}`);
  });
}

describe('MonitorPage', () => {
  beforeEach(() => {
    vi.stubGlobal('EventSource', FakeEventSource);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('loads the trace list as the default view', async () => {
    const fetchMock = routeFetch({
      '/monitor/traces': { items: [sampleTrace], total: 1, windowMs: 900_000 },
      '/monitor/logs': emptyLogPage,
      '/monitor/stats': emptyStats,
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<MonitorPage />);

    // 默认视图是追踪列表：一行一个追踪
    expect(await screen.findByText('http_request')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/monitor/traces'),
      expect.anything(),
    );
  });

  it('shows the traces error state and retries on click', async () => {
    let fail = true;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.startsWith('/monitor/traces')) {
        if (fail) {
          return jsonResponse({ error: { code: 'boom', message: '追踪加载失败' } }, 500);
        }

        return jsonResponse({ items: [sampleTrace], total: 1, windowMs: 900_000 });
      }

      if (url.startsWith('/monitor/logs')) {
        return jsonResponse(emptyLogPage);
      }

      return jsonResponse(emptyStats);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<MonitorPage />);

    expect(await screen.findByText(/追踪加载失败/)).toBeTruthy();

    fail = false;
    fireEvent.click(screen.getByText('重试'));

    expect(await screen.findByText('http_request')).toBeTruthy();
  });

  it('switches to the raw log view with the view toggle', async () => {
    const rawLog = {
      id: 7,
      traceId: 'trace-1',
      spanId: null,
      parentId: null,
      timestamp: 1_000,
      level: 'info',
      category: 'http',
      message: 'http_request',
      payload: { method: 'GET', path: '/health', statusCode: 200 },
      durationMs: 12,
      error: null,
      canvasId: null,
      revision: null,
      actor: null,
      source: 'daemon',
      target: 'browser',
    };
    const fetchMock = routeFetch({
      '/monitor/traces': { items: [sampleTrace], total: 1, windowMs: 900_000 },
      '/monitor/logs': { items: [rawLog], total: 1, limit: 200, offset: 0 },
      '/monitor/stats': emptyStats,
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<MonitorPage />);
    await screen.findByText('http_request');

    fireEvent.click(screen.getByText('原始日志'));

    // 逐条视图渲染方向列与耗时列
    expect(screen.getByText('Daemon → 浏览器')).toBeTruthy();
    expect(screen.getByText('12ms')).toBeTruthy();
  });
});

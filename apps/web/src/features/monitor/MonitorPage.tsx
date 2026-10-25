import type { AgentLog, MonitorStats } from '@paintcodex/protocol';
import { useCallback, useEffect, useRef, useState } from 'react';
import { LogList } from './LogList';
import { StatsPanel } from './StatsPanel';
import { TraceView } from './TraceView';
import {
  DEFAULT_STATS_WINDOW_MS,
  fetchLogs,
  fetchStats,
  subscribeToLogs,
} from './monitor-api';
import {
  DEFAULT_LOG_FILTERS,
  mergeLogs,
  rangeToSince,
  type LogFilterState,
} from './monitor-format';
import './monitor.css';

const LOG_FETCH_LIMIT = 200;
const STATS_WINDOW_MS = DEFAULT_STATS_WINDOW_MS;
const STATS_REFRESH_MS = 5_000;
const STATS_MIN_INTERVAL_MS = 2_000;

type LiveState = 'connecting' | 'live' | 'error';

export function MonitorPage() {
  const [logs, setLogs] = useState<AgentLog[]>([]);
  const [filters, setFilters] = useState<LogFilterState>(DEFAULT_LOG_FILTERS);
  const [stats, setStats] = useState<MonitorStats | null>(null);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [loadingLogs, setLoadingLogs] = useState(true);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [liveState, setLiveState] = useState<LiveState>('connecting');

  const disposed = useRef(false);
  const statsInFlight = useRef(false);
  const lastStatsAt = useRef(0);
  const statsTimer = useRef<number | null>(null);

  const loadStats = useCallback(async () => {
    if (statsInFlight.current) {
      return;
    }

    statsInFlight.current = true;
    lastStatsAt.current = Date.now();

    try {
      const next = await fetchStats(STATS_WINDOW_MS);

      if (!disposed.current) {
        setStats(next);
        setStatsError(null);
      }
    } catch (cause) {
      if (!disposed.current) {
        setStatsError(cause instanceof Error ? cause.message : '无法加载统计数据');
      }
    } finally {
      statsInFlight.current = false;
    }
  }, []);

  const scheduleStatsRefresh = useCallback(() => {
    if (statsTimer.current !== null) {
      return;
    }

    // Coalesce bursts of new logs into at most one refresh per interval.
    const elapsed = Date.now() - lastStatsAt.current;
    const wait = Math.max(0, STATS_MIN_INTERVAL_MS - elapsed);

    statsTimer.current = window.setTimeout(() => {
      statsTimer.current = null;
      void loadStats();
    }, wait);
  }, [loadStats]);

  const loadLogs = useCallback(async (nextFilters: LogFilterState) => {
    try {
      const page = await fetchLogs({
        limit: LOG_FETCH_LIMIT,
        category: nextFilters.category === 'all' ? undefined : nextFilters.category,
        level: nextFilters.level === 'all' ? undefined : nextFilters.level,
        since: rangeToSince(nextFilters.range),
      });

      if (disposed.current) {
        return;
      }

      // Replace rather than merge so the list reflects server-side filters.
      setLogs(page.items);
      setLogsError(null);
    } catch (cause) {
      if (!disposed.current) {
        setLogsError(cause instanceof Error ? cause.message : '无法加载日志');
      }
    } finally {
      if (!disposed.current) {
        setLoadingLogs(false);
      }
    }
  }, []);

  useEffect(() => {
    disposed.current = false;

    return () => {
      disposed.current = true;

      if (statsTimer.current !== null) {
        window.clearTimeout(statsTimer.current);
        statsTimer.current = null;
      }
    };
  }, []);

  useEffect(() => {
    void loadLogs(filters);
  }, [filters, loadLogs]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  useEffect(() => {
    const timer = window.setInterval(() => void loadStats(), STATS_REFRESH_MS);

    return () => window.clearInterval(timer);
  }, [loadStats]);

  useEffect(() => {
    if (paused) {
      return;
    }

    setLiveState('connecting');

    const unsubscribe = subscribeToLogs({
      onOpen: () => setLiveState('live'),
      onLog: (log) => {
        setLogs((current) => mergeLogs(current, [log]));
        scheduleStatsRefresh();
      },
      onError: () => setLiveState('error'),
    });

    return unsubscribe;
  }, [paused, scheduleStatsRefresh]);

  function handleRefresh() {
    setLoadingLogs(true);
    setLogsError(null);
    setStatsError(null);
    void loadLogs(filters);
    void loadStats();
  }

  const liveLabel = paused
    ? '已暂停'
    : liveState === 'live'
      ? '实时中'
      : liveState === 'error'
        ? '重新连接中…'
        : '连接中…';

  return (
    <div className="monitor-page">
      <div className="monitor-toolbar">
        <span
          className={
            paused ? 'monitor-live monitor-live--paused' : `monitor-live monitor-live--${liveState}`
          }
        >
          <span className="monitor-live__dot" aria-hidden="true" />
          {liveLabel}
        </span>
        <span className="monitor-muted">{logs.length} 条日志已缓存</span>
        <span className="monitor-spacer" />
        <button
          type="button"
          className="monitor-button"
          onClick={handleRefresh}
          disabled={loadingLogs}
        >
          {loadingLogs ? '刷新中…' : '刷新'}
        </button>
        <button
          type="button"
          className="monitor-button"
          onClick={() => setPaused((value) => !value)}
          aria-pressed={paused}
        >
          {paused ? '继续实时' : '暂停实时'}
        </button>
      </div>

      {logsError ? (
        <p className="monitor-error" role="alert">
          Logs: {logsError}
        </p>
      ) : null}

      <StatsPanel stats={stats} error={statsError} />

      <div className="monitor-grid">
        <div className="monitor-grid__logs">
          <LogList
            logs={logs}
            filters={filters}
            selectedTraceId={selectedTraceId}
            loading={loadingLogs}
            onFiltersChange={setFilters}
            onSelectTrace={setSelectedTraceId}
          />
        </div>
        <div className="monitor-grid__trace">
          <TraceView traceId={selectedTraceId} onClose={() => setSelectedTraceId(null)} />
        </div>
      </div>
    </div>
  );
}

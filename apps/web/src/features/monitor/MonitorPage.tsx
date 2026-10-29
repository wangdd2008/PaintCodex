import type { AgentLog, MonitorStats, TraceSummary } from '@paintcodex/protocol';
import { LOG_CATEGORIES, LOG_LEVELS } from '@paintcodex/protocol';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RawLogList } from './raw-log-list';
import { StatsPanel } from './StatsPanel';
import { TraceList } from './trace-list';
import {
  DEFAULT_STATS_WINDOW_MS,
  fetchLogs,
  fetchStats,
  fetchTraces,
  subscribeToLogs,
} from './monitor-api';
import {
  DEFAULT_LOG_FILTERS,
  filterLogs,
  formatLogLevel,
  mergeLogs,
  rangeToSince,
  type LogFilterState,
  type LogRange,
} from './monitor-format';
import './monitor.css';

const RANGE_OPTIONS: ReadonlyArray<{ value: LogRange; label: string }> = [
  { value: '5m', label: '最近 5 分钟' },
  { value: '15m', label: '最近 15 分钟' },
  { value: '1h', label: '最近 1 小时' },
  { value: 'all', label: '全部时间' },
];

/** 客户端只缓冲 200 条：聚合在服务端，缓冲只服务逐条视图（③04）。 */
const LOG_FETCH_LIMIT = 200;
const STATS_WINDOW_MS = DEFAULT_STATS_WINDOW_MS;
const STATS_REFRESH_MS = 5_000;
const STATS_MIN_INTERVAL_MS = 2_000;

type LiveState = 'connecting' | 'live' | 'error';

/** 监控页视图：默认按追踪聚合；「原始日志」切回逐条（spec §5）。 */
type MonitorView = 'traces' | 'raw';

interface TracesState {
  items: TraceSummary[];
  loading: boolean;
  error: string | null;
}

export function MonitorPage() {
  const [logs, setLogs] = useState<AgentLog[]>([]);
  const [filters, setFilters] = useState<LogFilterState>(DEFAULT_LOG_FILTERS);
  const [stats, setStats] = useState<MonitorStats | null>(null);
  const [traces, setTraces] = useState<TracesState>({
    items: [],
    loading: true,
    error: null,
  });
  const [view, setView] = useState<MonitorView>('traces');
  const [expandedTraceId, setExpandedTraceId] = useState<string | null>(null);
  const [expandedLogId, setExpandedLogId] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
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
    }
  }, []);

  const loadTraces = useCallback(async () => {
    setTraces((current) => ({ ...current, loading: true }));

    try {
      const page = await fetchTraces();

      if (!disposed.current) {
        setTraces({ items: page.items ?? [], loading: false, error: null });
      }
    } catch (cause) {
      if (!disposed.current) {
        setTraces((current) => ({
          ...current,
          loading: false,
          error: cause instanceof Error ? cause.message : '无法加载追踪',
        }));
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
    void loadTraces();
  }, [loadTraces]);

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
    void loadLogs(filters);
    void loadTraces();
    void loadStats();
  }

  const visibleLogs = useMemo(() => filterLogs(logs, filters), [logs, filters]);
  // 没有 traceId 的记录进「未归组」分段，不再渲染成不可点的死行。
  const untracedLogs = visibleLogs.filter((log) => log.traceId === null);

  function toggleTrace(traceId: string) {
    setExpandedTraceId((current) => (current === traceId ? null : traceId));
  }

  function toggleLog(logId: number) {
    setExpandedLogId((current) => (current === logId ? null : logId));
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
        <div className="monitor-view-switch" role="group" aria-label="视图切换">
          <button
            type="button"
            className={
              view === 'traces'
                ? 'monitor-button monitor-button--active'
                : 'monitor-button'
            }
            aria-pressed={view === 'traces'}
            onClick={() => setView('traces')}
          >
            追踪视图
          </button>
          <button
            type="button"
            className={
              view === 'raw' ? 'monitor-button monitor-button--active' : 'monitor-button'
            }
            aria-pressed={view === 'raw'}
            onClick={() => setView('raw')}
          >
            原始日志
          </button>
        </div>
        <button type="button" className="monitor-button" onClick={handleRefresh}>
          刷新
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
          日志加载失败：{logsError}
        </p>
      ) : null}

      <StatsPanel stats={stats} error={statsError} />

      <section className="log-list" aria-label={view === 'traces' ? '追踪' : '原始日志'}>
        <div className="log-list__header">
          <h2 className="monitor-heading">
            {view === 'traces' ? '追踪' : '原始日志'}
          </h2>
          <span className="monitor-muted">
            {view === 'traces'
              ? `${traces.items.length} 个追踪`
              : `${visibleLogs.length} / ${logs.length} 条`}
          </span>
          <span className="monitor-spacer" />
          {traces.loading && view === 'traces' ? (
            <span className="monitor-muted">加载中…</span>
          ) : null}
        </div>

        <div className="log-list__filters">
          <label className="monitor-field">
            <span>分类</span>
            <select
              value={filters.category}
              onChange={(event) =>
                setFilters({
                  ...filters,
                  category: event.target.value as LogFilterState['category'],
                })
              }
            >
              <option value="all">全部分类</option>
              {LOG_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>
          <label className="monitor-field">
            <span>级别</span>
            <select
              value={filters.level}
              onChange={(event) =>
                setFilters({
                  ...filters,
                  level: event.target.value as LogFilterState['level'],
                })
              }
            >
              <option value="all">全部级别</option>
              {LOG_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {formatLogLevel(level)}
                </option>
              ))}
            </select>
          </label>
          <label className="monitor-field">
            <span>时间窗口</span>
            <select
              value={filters.range}
              onChange={(event) =>
                setFilters({ ...filters, range: event.target.value as LogFilterState['range'] })
              }
            >
              {RANGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="log-list__scroll">
          {view === 'traces' ? (
            <>
              <TraceList
                items={traces.items}
                loading={traces.loading}
                error={traces.error}
                expandedTraceId={expandedTraceId}
                onToggle={toggleTrace}
                onRetry={() => void loadTraces()}
              />
              {untracedLogs.length > 0 ? (
                <div className="untraced-section">
                  <h3 className="monitor-heading">未归组（{untracedLogs.length}）</h3>
                  <RawLogList
                    logs={untracedLogs}
                    expandedLogId={expandedLogId}
                    onToggleLog={toggleLog}
                  />
                </div>
              ) : null}
            </>
          ) : (
            <RawLogList
              logs={visibleLogs}
              expandedLogId={expandedLogId}
              onToggleLog={toggleLog}
            />
          )}
        </div>
      </section>
    </div>
  );
}

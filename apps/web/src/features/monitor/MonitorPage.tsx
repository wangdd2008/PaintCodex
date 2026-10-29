import type {
  AgentLog,
  LogComponent,
  MonitorStats,
  TopologySnapshot,
} from '@paintcodex/protocol';
import { useCallback, useEffect, useRef, useState } from 'react';
import { LogList } from './LogList';
import { StatsPanel } from './StatsPanel';
import { TopologyView } from './TopologyView';
import { TraceView } from './TraceView';
import {
  DEFAULT_STATS_WINDOW_MS,
  fetchLogs,
  fetchStats,
  fetchTopology,
  subscribeToLogs,
} from './monitor-api';
import {
  DEFAULT_LOG_FILTERS,
  mergeLogs,
  rangeToSince,
  type LogFilterState,
} from './monitor-format';
import {
  chipLabel,
  toggleTopologyChip,
  type TopologyChip,
} from './topology-filter';
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
  const [topology, setTopology] = useState<TopologySnapshot | null>(null);
  const [chip, setChip] = useState<TopologyChip | null>(null);
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

  /**
   * 拓扑快照与统计卡片同窗口（5 分钟）。取数失败不影响页面其余部分：
   * 图保持上一次快照，静态结构本来就不依赖当次取数。
   */
  const loadTopology = useCallback(async () => {
    try {
      const next = await fetchTopology(STATS_WINDOW_MS);

      if (!disposed.current) {
        setTopology(next);
      }
    } catch {
      // 静默失败：图上一轮的数字仍在，下一周期会重试。
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
    void loadTopology();
  }, [loadTopology]);

  useEffect(() => {
    const timer = window.setInterval(() => void loadStats(), STATS_REFRESH_MS);

    return () => window.clearInterval(timer);
  }, [loadStats]);

  useEffect(() => {
    const timer = window.setInterval(() => void loadTopology(), STATS_REFRESH_MS);

    return () => window.clearInterval(timer);
  }, [loadTopology]);

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

  /** 拓扑点击：同一时刻只有一个 chip；重复点击即取消（票 ③06）。 */
  function handleToggleNode(component: LogComponent) {
    setChip((current) => toggleTopologyChip(current, { kind: 'component', component }));
  }

  function handleToggleChannel(channelId: string) {
    setChip((current) => toggleTopologyChip(current, { kind: 'channel', channelId }));
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
          日志加载失败：{logsError}
        </p>
      ) : null}

      <StatsPanel stats={stats} error={statsError} />

      <TopologyView
        snapshot={topology}
        chip={chip}
        onToggleNode={handleToggleNode}
        onToggleChannel={handleToggleChannel}
      />

      {chip ? (
        <div className="monitor-chipbar" role="status">
          <span className="monitor-chip">{chipLabel(chip)}</span>
          <button
            type="button"
            className="monitor-button monitor-button--ghost"
            onClick={() => setChip(null)}
          >
            取消过滤
          </button>
        </div>
      ) : null}

      <div className="monitor-grid">
        <div className="monitor-grid__logs">
          <LogList
            logs={logs}
            filters={filters}
            chip={chip}
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

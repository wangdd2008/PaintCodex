import type { AgentLog } from '@paintcodex/protocol';
import { LOG_CATEGORIES, LOG_LEVELS } from '@paintcodex/protocol';
import { useMemo, useState, type KeyboardEvent } from 'react';
import { logMatchesChip, type TopologyChip } from './topology-filter';
import {
  DEFAULT_LOG_SORT,
  filterLogs,
  formatDuration,
  formatLogLevel,
  formatTimestamp,
  shortenId,
  sortLogs,
  type LogCategoryFilter,
  type LogFilterState,
  type LogLevelFilter,
  type LogRange,
  type LogSort,
  type LogSortField,
} from './monitor-format';

interface LogListProps {
  logs: readonly AgentLog[];
  filters: LogFilterState;
  chip: TopologyChip | null;
  selectedTraceId: string | null;
  loading: boolean;
  onFiltersChange: (filters: LogFilterState) => void;
  onSelectTrace: (traceId: string) => void;
}

const RANGE_OPTIONS: readonly { value: LogRange; label: string }[] = [
  { value: '5m', label: '最近 5 分钟' },
  { value: '15m', label: '最近 15 分钟' },
  { value: '1h', label: '最近 1 小时' },
  { value: 'all', label: '全部时间' },
];

export function LogList({
  logs,
  filters,
  chip,
  selectedTraceId,
  loading,
  onFiltersChange,
  onSelectTrace,
}: LogListProps) {
  const [sort, setSort] = useState<LogSort>(DEFAULT_LOG_SORT);

  // chip 来自拓扑图点击（票 ③06）：在分类过滤之后、排序之前叠加。
  const visibleLogs = useMemo(() => {
    const filtered = filterLogs(logs, filters);
    const afterChip =
      chip === null ? filtered : filtered.filter((log) => logMatchesChip(log, chip));

    return sortLogs(afterChip, sort);
  }, [logs, filters, chip, sort]);

  function toggleSort(field: LogSortField) {
    setSort((current) =>
      current.field === field
        ? { field, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { field, direction: 'desc' },
    );
  }

  function sortIndicator(field: LogSortField): string {
    if (sort.field !== field) {
      return '↕';
    }

    return sort.direction === 'asc' ? '↑' : '↓';
  }

  function ariaSort(field: LogSortField): 'ascending' | 'descending' | 'none' {
    if (sort.field !== field) {
      return 'none';
    }

    return sort.direction === 'asc' ? 'ascending' : 'descending';
  }

  function handleRowKeyDown(
    event: KeyboardEvent<HTMLTableRowElement>,
    traceId: string,
  ) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelectTrace(traceId);
    }
  }

  return (
    <section className="log-list" aria-label="日志">
      <div className="log-list__header">
        <h2 className="monitor-heading">日志</h2>
        <span className="monitor-muted">
          显示 {visibleLogs.length} / {logs.length} 条
        </span>
        <span className="monitor-spacer" />
        {loading ? <span className="monitor-muted">加载中…</span> : null}
      </div>

      <div className="log-list__filters">
        <label className="monitor-field">
          <span>分类</span>
          <select
            value={filters.category}
            onChange={(event) =>
              onFiltersChange({
                ...filters,
                category: event.target.value as LogCategoryFilter,
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
              onFiltersChange({
                ...filters,
                level: event.target.value as LogLevelFilter,
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
              onFiltersChange({
                ...filters,
                range: event.target.value as LogRange,
              })
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
        <table className="log-table">
          <thead>
            <tr>
              <th aria-sort={ariaSort('timestamp')}>
                <button
                  type="button"
                  className="log-table__sort"
                  onClick={() => toggleSort('timestamp')}
                >
                  时间 <span aria-hidden="true">{sortIndicator('timestamp')}</span>
                </button>
              </th>
              <th>级别</th>
              <th>分类</th>
              <th>消息</th>
              <th aria-sort={ariaSort('durationMs')}>
                <button
                  type="button"
                  className="log-table__sort"
                  onClick={() => toggleSort('durationMs')}
                >
                  耗时 <span aria-hidden="true">{sortIndicator('durationMs')}</span>
                </button>
              </th>
              <th>错误 / 追踪</th>
            </tr>
          </thead>
          <tbody>
            {visibleLogs.map((log) => {
              const traceId = log.traceId;
              const selected = traceId !== null && traceId === selectedTraceId;
              const className = [
                'log-table__row',
                traceId === null ? '' : 'log-table__row--linked',
                selected ? 'log-table__row--selected' : '',
              ]
                .filter((name) => name.length > 0)
                .join(' ');

              return (
                <tr
                  key={log.id}
                  className={className}
                  tabIndex={traceId === null ? undefined : 0}
                  aria-selected={selected}
                  title={traceId === null ? undefined : `查看追踪 ${traceId}`}
                  onClick={traceId === null ? undefined : () => onSelectTrace(traceId)}
                  onKeyDown={
                    traceId === null
                      ? undefined
                      : (event) => handleRowKeyDown(event, traceId)
                  }
                >
                  <td className="log-table__time">{formatTimestamp(log.timestamp)}</td>
                  <td>
                    <span className={`level-badge level-badge--${log.level}`}>
                      {formatLogLevel(log.level)}
                    </span>
                  </td>
                  <td>
                    <span className="category-badge">{log.category}</span>
                  </td>
                  <td className="log-table__message">
                    <span title={log.message}>{log.message}</span>
                  </td>
                  <td className="log-table__duration">{formatDuration(log.durationMs)}</td>
                  <td className="log-table__meta">
                    {log.error ? (
                      <span className="log-table__error" title={log.error}>
                        {log.error}
                      </span>
                    ) : null}
                    {traceId ? (
                      <span className="log-table__trace" title={traceId}>
                        {shortenId(traceId)}
                      </span>
                    ) : null}
                    {!log.error && traceId === null ? (
                      <span className="monitor-muted">—</span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {visibleLogs.length === 0 ? (
          <p className="monitor-empty">
            {loading ? '加载日志中…' : '没有符合当前筛选条件的日志。'}
          </p>
        ) : null}
      </div>
    </section>
  );
}

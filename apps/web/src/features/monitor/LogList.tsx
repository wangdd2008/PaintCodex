import type { AgentLog } from '@paintcodex/protocol';
import { LOG_CATEGORIES, LOG_LEVELS } from '@paintcodex/protocol';
import { useMemo, useState, type KeyboardEvent } from 'react';
import {
  DEFAULT_LOG_FILTERS,
  DEFAULT_LOG_SORT,
  filterLogs,
  formatDuration,
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
  selectedTraceId: string | null;
  loading: boolean;
  onSelectTrace: (traceId: string) => void;
}

const RANGE_OPTIONS: readonly { value: LogRange; label: string }[] = [
  { value: '5m', label: 'Last 5 min' },
  { value: '15m', label: 'Last 15 min' },
  { value: '1h', label: 'Last hour' },
  { value: 'all', label: 'All time' },
];

export function LogList({ logs, selectedTraceId, loading, onSelectTrace }: LogListProps) {
  const [filters, setFilters] = useState<LogFilterState>(DEFAULT_LOG_FILTERS);
  const [sort, setSort] = useState<LogSort>(DEFAULT_LOG_SORT);

  const visibleLogs = useMemo(
    () => sortLogs(filterLogs(logs, filters), sort),
    [logs, filters, sort],
  );

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
    <section className="log-list" aria-label="Agent logs">
      <div className="log-list__header">
        <h2 className="monitor-heading">Logs</h2>
        <span className="monitor-muted">
          {visibleLogs.length} of {logs.length}
        </span>
        <span className="monitor-spacer" />
        {loading ? <span className="monitor-muted">Loading…</span> : null}
      </div>

      <div className="log-list__filters">
        <label className="monitor-field">
          <span>Category</span>
          <select
            value={filters.category}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                category: event.target.value as LogCategoryFilter,
              }))
            }
          >
            <option value="all">All categories</option>
            {LOG_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </label>

        <label className="monitor-field">
          <span>Level</span>
          <select
            value={filters.level}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                level: event.target.value as LogLevelFilter,
              }))
            }
          >
            <option value="all">All levels</option>
            {LOG_LEVELS.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </label>

        <label className="monitor-field">
          <span>Window</span>
          <select
            value={filters.range}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                range: event.target.value as LogRange,
              }))
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
                  Time <span aria-hidden="true">{sortIndicator('timestamp')}</span>
                </button>
              </th>
              <th>Level</th>
              <th>Category</th>
              <th>Message</th>
              <th aria-sort={ariaSort('durationMs')}>
                <button
                  type="button"
                  className="log-table__sort"
                  onClick={() => toggleSort('durationMs')}
                >
                  Duration <span aria-hidden="true">{sortIndicator('durationMs')}</span>
                </button>
              </th>
              <th>Error / trace</th>
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
                  title={traceId === null ? undefined : `Open trace ${traceId}`}
                  onClick={traceId === null ? undefined : () => onSelectTrace(traceId)}
                  onKeyDown={
                    traceId === null
                      ? undefined
                      : (event) => handleRowKeyDown(event, traceId)
                  }
                >
                  <td className="log-table__time">{formatTimestamp(log.timestamp)}</td>
                  <td>
                    <span className={`level-badge level-badge--${log.level}`}>{log.level}</span>
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
            {loading ? 'Loading logs…' : 'No logs match the current filters.'}
          </p>
        ) : null}
      </div>
    </section>
  );
}

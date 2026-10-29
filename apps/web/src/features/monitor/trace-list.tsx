import { Fragment } from 'react';
import type { TraceSummary } from '@paintcodex/protocol';
import { formatComponentPath } from './log-format';
import { formatDuration, formatTimestamp } from './monitor-format';
import { TraceView } from './TraceView';

interface TraceListProps {
  items: readonly TraceSummary[];
  loading: boolean;
  error: string | null;
  expandedTraceId: string | null;
  onToggle: (traceId: string) => void;
  onRetry: () => void;
}

/**
 * 监控页默认视图：一行一个追踪（消费 GET /monitor/traces）。
 * 列＝开始时间 / 根消息 / 组件路径 / 节点数 / 错误数 / 总耗时；
 * 点击一行在同页内展开时序占位（③05），不跳页。
 */
export function TraceList({
  items,
  loading,
  error,
  expandedTraceId,
  onToggle,
  onRetry,
}: TraceListProps) {
  if (loading) {
    return <p className="monitor-empty">加载追踪中…</p>;
  }

  if (error !== null) {
    return (
      <p className="monitor-error" role="alert">
        追踪加载失败：{error}
        <button
          type="button"
          className="monitor-button monitor-button--ghost"
          onClick={onRetry}
        >
          重试
        </button>
      </p>
    );
  }

  if (items.length === 0) {
    return <p className="monitor-empty">当前时间窗口内暂无追踪。</p>;
  }

  return (
    <table className="log-table">
      <thead>
        <tr>
          <th>开始时间</th>
          <th>根消息</th>
          <th>组件路径</th>
          <th>节点数</th>
          <th>错误数</th>
          <th>总耗时</th>
        </tr>
      </thead>
      <tbody>
        {items.map((trace) => {
          const expanded = expandedTraceId === trace.traceId;

          return (
            <Fragment key={trace.traceId}>
              <tr
                className={
                  expanded
                    ? 'log-table__row log-table__row--selected'
                    : 'log-table__row log-table__row--linked'
                }
                onClick={() => onToggle(trace.traceId)}
              >
                <td className="log-table__time">{formatTimestamp(trace.startedAt)}</td>
                <td className="log-table__message">
                  <span className="trace-table__root" title={trace.rootMessage}>
                    {trace.rootMessage}
                  </span>
                  {trace.requestPath ? (
                    <span className="trace-table__path" title={trace.requestPath}>
                      {trace.requestPath}
                    </span>
                  ) : null}
                </td>
                <td>{formatComponentPath(trace.components)}</td>
                <td>{trace.spanCount}</td>
                <td className={trace.errorCount > 0 ? 'trace-table__error-count' : undefined}>
                  {trace.errorCount}
                </td>
                <td className="log-table__duration">
                  {formatDuration(trace.endedAt - trace.startedAt)}
                </td>
              </tr>
              {expanded ? (
                <tr className="trace-table__detail-row">
                  <td colSpan={6}>
                    <TraceView traceId={trace.traceId} onClose={() => onToggle(trace.traceId)} />
                  </td>
                </tr>
              ) : null}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

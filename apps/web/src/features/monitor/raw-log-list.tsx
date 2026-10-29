import { Fragment } from 'react';
import type { AgentLog } from '@paintcodex/protocol';
import { formatDirection } from './log-format';
import { LogDetail } from './log-detail';
import { formatDuration, formatLogLevel, formatTimestamp } from './monitor-format';

interface RawLogListProps {
  logs: readonly AgentLog[];
  expandedLogId: number | null;
  onToggleLog: (id: number) => void;
}

/**
 * 「原始日志」逐条视图：按 id DESC（落库顺序）由服务端返回，
 * 时间列显示开始时间，另有耗时列；点击一行就地展开 payload 明细。
 * 没有 traceId 的记录由页面侧归入「未归组」分段后复用本组件渲染。
 */
export function RawLogList({ logs, expandedLogId, onToggleLog }: RawLogListProps) {
  if (logs.length === 0) {
    return <p className="monitor-empty">没有符合当前筛选条件的日志。</p>;
  }

  return (
    <table className="log-table">
      <thead>
        <tr>
          <th>时间</th>
          <th>方向</th>
          <th>级别</th>
          <th>分类</th>
          <th>消息</th>
          <th>耗时</th>
        </tr>
      </thead>
      <tbody>
        {logs.map((log) => {
          const expanded = expandedLogId === log.id;

          return (
            <Fragment key={log.id}>
              <tr
                className={
                  expanded
                    ? 'log-table__row log-table__row--selected'
                    : 'log-table__row log-table__row--linked'
                }
                onClick={() => onToggleLog(log.id)}
              >
                <td className="log-table__time">{formatTimestamp(log.timestamp)}</td>
                <td>{formatDirection(log.source, log.target)}</td>
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
              </tr>
              {expanded ? (
                <tr className="trace-table__detail-row">
                  <td colSpan={6}>
                    <LogDetail payload={log.payload} error={log.error} />
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

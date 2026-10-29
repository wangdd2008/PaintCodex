import type { AgentLog, AgentTrace, AgentTraceNode } from '@paintcodex/protocol';
import { useEffect, useMemo, useState } from 'react';
import { ApiError } from '../../services/api';
import { LogDetail } from './log-detail';
import { formatDirection } from './log-format';
import { SequenceDiagram } from './SequenceDiagram';
import { fetchTrace } from './monitor-api';
import {
  formatDuration,
  formatLogLevel,
  formatTimestamp,
  shortenId,
} from './monitor-format';
import { buildSequence } from './trace-sequence';

interface TraceViewProps {
  traceId: string | null;
  onClose: () => void;
}

type TraceStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

type ViewMode = 'sequence' | 'tree';

interface TraceState {
  status: TraceStatus;
  trace: AgentTrace | null;
  error: string | null;
}

const IDLE_STATE: TraceState = { status: 'idle', trace: null, error: null };

export function TraceView({ traceId, onClose }: TraceViewProps) {
  const [state, setState] = useState<TraceState>(IDLE_STATE);
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  const [reloadToken, setReloadToken] = useState(0);
  // 时序图为默认（spec §7）；层级树保留父子结构。
  const [viewMode, setViewMode] = useState<ViewMode>('sequence');
  const [selectedLog, setSelectedLog] = useState<AgentLog | null>(null);

  useEffect(() => {
    if (traceId === null) {
      setState(IDLE_STATE);
      setExpanded(new Set());
      setSelectedLog(null);
      return;
    }

    const controller = new AbortController();
    let active = true;
    setState({ status: 'loading', trace: null, error: null });

    fetchTrace(traceId, controller.signal)
      .then((trace) => {
        if (!active) {
          return;
        }

        // Roots start expanded so their direct children are visible.
        setExpanded(new Set(trace.roots.map((node) => node.log.id)));
        setSelectedLog(null);
        setState({
          status: trace.roots.length === 0 ? 'empty' : 'ready',
          trace,
          error: null,
        });
      })
      .catch((cause: unknown) => {
        if (!active || controller.signal.aborted) {
          return;
        }

        if (cause instanceof ApiError && cause.status === 404) {
          setState({ status: 'empty', trace: null, error: null });
          return;
        }

        setState({
          status: 'error',
          trace: null,
          error: cause instanceof Error ? cause.message : '无法加载追踪',
        });
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [traceId, reloadToken]);

  // 同一份数据算一次布局，两种视图共用。
  const sequence = useMemo(
    () => (state.trace ? buildSequence(state.trace) : null),
    [state.trace],
  );

  function toggleNode(id: number) {
    setExpanded((current) => {
      const next = new Set(current);

      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      return next;
    });
  }

  function selectLog(log: AgentLog) {
    setSelectedLog(log);
  }

  const ready = state.status === 'ready' && state.trace !== null && sequence !== null;

  return (
    <section className="trace-view" aria-label="追踪详情">
      <div className="trace-view__header">
        <h2 className="monitor-heading">追踪</h2>
        {traceId ? (
          <span className="monitor-muted" title={traceId}>
            {shortenId(traceId, 12)}
          </span>
        ) : null}
        {ready ? (
          <div className="trace-view__switch" role="group" aria-label="追踪内部视图">
            <button
              type="button"
              className="trace-view__tab"
              aria-pressed={viewMode === 'sequence'}
              onClick={() => setViewMode('sequence')}
            >
              时序图
            </button>
            <button
              type="button"
              className="trace-view__tab"
              aria-pressed={viewMode === 'tree'}
              onClick={() => setViewMode('tree')}
            >
              层级树
            </button>
          </div>
        ) : null}
        <span className="monitor-spacer" />
        {traceId ? (
          <button
            type="button"
            className="monitor-button monitor-button--ghost"
            onClick={() => setReloadToken((value) => value + 1)}
            disabled={state.status === 'loading'}
          >
            刷新
          </button>
        ) : null}
        {traceId ? (
          <button
            type="button"
            className="monitor-button monitor-button--ghost"
            onClick={onClose}
            aria-label="关闭追踪"
          >
            ×
          </button>
        ) : null}
      </div>

      <div className="trace-view__body">
        {traceId === null ? (
          <p className="monitor-empty">选择一个带有追踪的日志以查看其节点。</p>
        ) : state.status === 'loading' ? (
          <p className="monitor-empty">加载追踪中…</p>
        ) : state.status === 'error' ? (
          <p className="monitor-error">{state.error ?? '无法加载追踪'}</p>
        ) : !ready ? (
          <p className="monitor-empty">此追踪没有记录任何节点。</p>
        ) : viewMode === 'sequence' ? (
          <SequenceDiagram
            model={sequence}
            selectedLogId={selectedLog?.id ?? null}
            onSelect={selectLog}
          />
        ) : (
          <ul className="trace-tree">
            {state.trace?.roots.map((node) => (
              <TraceNodeRow
                key={node.log.id}
                node={node}
                depth={0}
                expanded={expanded}
                selectedLogId={selectedLog?.id ?? null}
                onToggle={toggleNode}
                onSelect={selectLog}
              />
            ))}
          </ul>
        )}
      </div>

      <div className="trace-view__detail">
        {selectedLog === null ? (
          <div className="log-detail log-detail--empty monitor-empty">
            点击时序图或层级树中的任一记录，在此查看其明细。
          </div>
        ) : (
          <LogDetail payload={selectedLog.payload} error={selectedLog.error ?? null} />
        )}
      </div>
    </section>
  );
}

interface TraceNodeRowProps {
  node: AgentTraceNode;
  depth: number;
  expanded: ReadonlySet<number>;
  selectedLogId: number | null;
  onToggle: (id: number) => void;
  onSelect: (log: AgentLog) => void;
}

function TraceNodeRow({
  node,
  depth,
  expanded,
  selectedLogId,
  onToggle,
  onSelect,
}: TraceNodeRowProps) {
  const log = node.log;
  const hasChildren = node.children.length > 0;
  const isOpen = expanded.has(log.id);
  const isSelected = log.id === selectedLogId;
  const indent = depth * 16;

  return (
    <li className="trace-node">
      <div
        className={`trace-node__row ${isSelected ? 'trace-node__row--selected' : ''}`}
        style={{ paddingLeft: `${indent}px` }}
        onClick={() => onSelect(log)}
        data-testid="trace-tree-row"
        data-log-id={log.id}
      >
        {hasChildren ? (
          <button
            type="button"
            className="trace-node__toggle"
            aria-expanded={isOpen}
            aria-label={isOpen ? '折叠节点' : '展开节点'}
            onClick={(event) => {
              event.stopPropagation();
              onToggle(log.id);
            }}
          >
            {isOpen ? '▾' : '▸'}
          </button>
        ) : (
          <span className="trace-node__toggle trace-node__toggle--leaf" aria-hidden="true">
            •
          </span>
        )}
        <span className="trace-node__time">{formatTimestamp(log.timestamp)}</span>
        <span className={`level-badge level-badge--${log.level}`}>
          {formatLogLevel(log.level)}
        </span>
        <span className="trace-node__message" title={log.message}>
          {log.message}
        </span>
        <span
          className="trace-node__direction"
          title={formatDirection(log.source, log.target)}
        >
          {formatDirection(log.source, log.target)}
        </span>
        <span className="category-badge">{log.category}</span>
        <span className="trace-node__duration">{formatDuration(log.durationMs)}</span>
      </div>

      {log.error ? (
        <p className="trace-node__error" style={{ marginLeft: `${indent + 24}px` }}>
          {log.error}
        </p>
      ) : null}

      {hasChildren && isOpen ? (
        <ul className="trace-tree trace-tree--nested">
          {node.children.map((child) => (
            <TraceNodeRow
              key={child.log.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              selectedLogId={selectedLogId}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

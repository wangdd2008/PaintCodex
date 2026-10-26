import type { AgentTrace, AgentTraceNode } from '@paintcodex/protocol';
import { useEffect, useState } from 'react';
import { ApiError } from '../../services/api';
import { fetchTrace } from './monitor-api';
import { formatDuration, formatLogLevel, formatTimestamp, shortenId } from './monitor-format';

interface TraceViewProps {
  traceId: string | null;
  onClose: () => void;
}

type TraceStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

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

  useEffect(() => {
    if (traceId === null) {
      setState(IDLE_STATE);
      setExpanded(new Set());
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

  return (
    <section className="trace-view" aria-label="追踪详情">
      <div className="trace-view__header">
        <h2 className="monitor-heading">追踪</h2>
        {traceId ? (
          <span className="monitor-muted" title={traceId}>
            {shortenId(traceId, 12)}
          </span>
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
        ) : state.trace === null || state.trace.roots.length === 0 ? (
          <p className="monitor-empty">此追踪没有记录任何节点。</p>
        ) : (
          <ul className="trace-tree">
            {state.trace.roots.map((node) => (
              <TraceNodeRow
                key={node.log.id}
                node={node}
                depth={0}
                expanded={expanded}
                onToggle={toggleNode}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

interface TraceNodeRowProps {
  node: AgentTraceNode;
  depth: number;
  expanded: ReadonlySet<number>;
  onToggle: (id: number) => void;
}

function TraceNodeRow({ node, depth, expanded, onToggle }: TraceNodeRowProps) {
  const log = node.log;
  const hasChildren = node.children.length > 0;
  const isOpen = expanded.has(log.id);
  const indent = depth * 16;

  return (
    <li className="trace-node">
      <div className="trace-node__row" style={{ paddingLeft: `${indent}px` }}>
        {hasChildren ? (
          <button
            type="button"
            className="trace-node__toggle"
            aria-expanded={isOpen}
            aria-label={isOpen ? '折叠节点' : '展开节点'}
            onClick={() => onToggle(log.id)}
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
              onToggle={onToggle}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

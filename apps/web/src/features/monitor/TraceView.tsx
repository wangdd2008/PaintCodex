import type { AgentTrace, AgentTraceNode } from '@paintcodex/protocol';
import { useEffect, useState } from 'react';
import { ApiError } from '../../services/api';
import { fetchTrace } from './monitor-api';
import { formatDuration, formatTimestamp, shortenId } from './monitor-format';

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
          error: cause instanceof Error ? cause.message : 'Could not load trace',
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
    <section className="trace-view" aria-label="Trace detail">
      <div className="trace-view__header">
        <h2 className="monitor-heading">Trace</h2>
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
            Refresh
          </button>
        ) : null}
        {traceId ? (
          <button
            type="button"
            className="monitor-button monitor-button--ghost"
            onClick={onClose}
            aria-label="Close trace"
          >
            ×
          </button>
        ) : null}
      </div>

      <div className="trace-view__body">
        {traceId === null ? (
          <p className="monitor-empty">Select a log with a trace to inspect its spans.</p>
        ) : state.status === 'loading' ? (
          <p className="monitor-empty">Loading trace…</p>
        ) : state.status === 'error' ? (
          <p className="monitor-error">{state.error ?? 'Could not load trace'}</p>
        ) : state.trace === null || state.trace.roots.length === 0 ? (
          <p className="monitor-empty">No spans recorded for this trace.</p>
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
            aria-label={isOpen ? 'Collapse span' : 'Expand span'}
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
        <span className={`level-badge level-badge--${log.level}`}>{log.level}</span>
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

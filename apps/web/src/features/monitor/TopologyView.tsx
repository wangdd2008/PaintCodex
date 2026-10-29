import type { KeyboardEvent } from 'react';
import type { LogComponent, TopologySnapshot } from '@paintcodex/protocol';
import { formatDuration } from './monitor-format';
import type { TopologyChip } from './topology-filter';
import {
  TOPOLOGY_CHANNELS,
  TOPOLOGY_NODES,
  TOPOLOGY_VIEW_BOX,
  channelStatsOf,
  nodeById,
  nodeStatsOf,
  type TopologyChannelLayout,
  type TopologyNodeLayout,
} from './topology-layout';

interface TopologyViewProps {
  snapshot: TopologySnapshot | null;
  chip: TopologyChip | null;
  onToggleNode: (component: LogComponent) => void;
  onToggleChannel: (channelId: string) => void;
}

/**
 * 静态拓扑 + 实时叠加（票 ③06 / ADR-0012）。
 * 节点与通道写死，观测数字叠加其上；无流量时数字为 0，图不变形。
 * 节点可聚焦、可键盘遍历，整图有可读 aria-label。
 */
export function TopologyView({
  snapshot,
  chip,
  onToggleNode,
  onToggleChannel,
}: TopologyViewProps) {
  return (
    <section className="topology-panel" aria-label="组件拓扑">
      <div className="stats-panel__header">
        <h2 className="monitor-heading">拓扑</h2>
        <span className="monitor-muted">最近 5 分钟 · 平均耗时不含长连接</span>
        <span className="monitor-spacer" />
        <span className="monitor-muted">实线可观测 · 虚线间接观测</span>
      </div>

      <div className="topology__scroll">
        <svg
          className="topology-svg"
          viewBox={`0 0 ${TOPOLOGY_VIEW_BOX.width} ${TOPOLOGY_VIEW_BOX.height}`}
          role="group"
          aria-label="组件通信拓扑：浏览器、Daemon、Codex、模型与 SQLite 及其通道"
        >
          {TOPOLOGY_CHANNELS.map((channel) => (
            <TopologyChannel
              key={channel.id}
              channel={channel}
              stats={channelStatsOf(snapshot, channel)}
              active={chip?.kind === 'channel' && chip.channelId === channel.id}
              onToggle={() => onToggleChannel(channel.id)}
            />
          ))}
          {TOPOLOGY_NODES.map((node) => (
            <TopologyNode
              key={node.id}
              node={node}
              stats={nodeStatsOf(snapshot, node.id)}
              active={chip?.kind === 'component' && chip.component === node.id}
              onToggle={() => onToggleNode(node.id)}
            />
          ))}
        </svg>
      </div>
    </section>
  );
}

interface TopologyChannelProps {
  channel: TopologyChannelLayout;
  stats: { count: number; errorCount: number; avgDurationMs: number | null };
  active: boolean;
  onToggle: () => void;
}

function TopologyChannel({ channel, stats, active, onToggle }: TopologyChannelProps) {
  const a = nodeById(channel.a);
  const b = nodeById(channel.b);

  if (a === undefined || b === undefined) {
    return null;
  }

  const midX = (a.x + b.x) / 2;
  const midY = (a.y + b.y) / 2;
  const classes = [
    'topology-edge',
    channel.dashed ? 'topology-edge--dashed' : '',
    stats.errorCount > 0 ? 'topology-edge--error' : '',
    active ? 'topology-edge--active' : '',
  ]
    .filter((name) => name.length > 0)
    .join(' ');

  const description = `${a.label} 与 ${b.label} 之间：${stats.count} 条消息`;

  function handleKeyDown(event: KeyboardEvent<SVGLineElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onToggle();
    }
  }

  return (
    <g>
      <line
        x1={a.x}
        y1={a.y}
        x2={b.x}
        y2={b.y}
        className={classes}
      />
      {/* 透明加宽命中带：让通道整体可点、可聚焦，而不只靠那 1px 的线。 */}
      <line
        x1={a.x}
        y1={a.y}
        x2={b.x}
        y2={b.y}
        className="topology-edge-hit"
        role="button"
        tabIndex={0}
        aria-label={`过滤 ${description}${active ? '（再次按回车取消过滤）' : ''}`}
        aria-pressed={active}
        onClick={onToggle}
        onKeyDown={handleKeyDown}
      />
      <text x={midX} y={midY - 8} className="topology-edge__count" textAnchor="middle">
        {stats.count} 条
      </text>
      <text x={midX} y={midY + 10} className="topology-edge__hint" textAnchor="middle">
        {stats.errorCount > 0 ? `${stats.errorCount} 错误 · ` : ''}
        {stats.avgDurationMs === null ? '—' : formatDuration(stats.avgDurationMs)}
      </text>
    </g>
  );
}

interface TopologyNodeProps {
  node: TopologyNodeLayout;
  stats: { count: number; errorCount: number };
  active: boolean;
  onToggle: () => void;
}

function TopologyNode({ node, stats, active, onToggle }: TopologyNodeProps) {
  const error = stats.errorCount > 0;
  // model 的数字永远无法归因（daemon 看不见它与 codex 的流量）：显示「—」而不是 0。
  const countText = node.unattributable ? '—' : String(stats.count);
  const classes = [
    'topology-node',
    error ? 'topology-node--error' : '',
    active ? 'topology-node--active' : '',
  ]
    .filter((name) => name.length > 0)
    .join(' ');

  function handleKeyDown(event: KeyboardEvent<SVGGElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onToggle();
    }
  }

  return (
    <g
      className={classes}
      role="button"
      tabIndex={0}
      aria-label={`${node.label}：${node.unattributable ? '观测不到流量' : `${stats.count} 条消息`}${error ? `，${stats.errorCount} 个错误` : ''}${active ? '（再次按回车取消过滤）' : ''}`}
      aria-pressed={active}
      onClick={onToggle}
      onKeyDown={handleKeyDown}
    >
      {/* 错误不只靠颜色：外圈 + 实心角标双重区分。 */}
      {error ? <circle cx={node.x} cy={node.y} r={32} className="topology-node__error-ring" /> : null}
      <circle cx={node.x} cy={node.y} r={26} className="topology-node__circle" />
      {error ? (
        <circle cx={node.x + 20} cy={node.y - 20} r={9} className="topology-node__error-badge" />
      ) : null}
      {error ? (
        <text
          x={node.x + 20}
          y={node.y - 17}
          className="topology-node__error-badge-text"
          textAnchor="middle"
        >
          !
        </text>
      ) : null}
      <text x={node.x} y={node.y + 5} className="topology-node__label" textAnchor="middle">
        {node.label}
      </text>
      <text x={node.x} y={node.y + 44} className="topology-node__count" textAnchor="middle">
        {countText} 条
        {error && !node.unattributable ? ` · ${stats.errorCount} 错` : ''}
      </text>
    </g>
  );
}

import type {
  LogComponent,
  TopologyEdgeStats,
  TopologySnapshot,
} from '@paintcodex/protocol';

/**
 * 拓扑的静态声明（ADR-0012）：5 个节点固定坐标、4 条通道写死在代码里，
 * 观测数据只叠加在既有结构上——冷启动时图依然完整，不因无流量变形。
 *
 * 实线 = 可观测通道（daemon 看得见这一跳的日志）；
 * 虚线 = 间接观测（codex ⇄ 模型、daemon ⇄ SQLite 的读路径没有直接日志）。
 */

export interface TopologyNodeLayout {
  id: LogComponent;
  /** 节点中心坐标，与 VIEW_BOX 同一坐标系。 */
  x: number;
  y: number;
  /** 节点中文名，直接画在 SVG 里。 */
  label: string;
  /** model 没有任何直接日志，数字恒无法归因，前端显示「—」而不是 0。 */
  unattributable?: boolean;
}

export interface TopologyChannelLayout {
  id: string;
  a: LogComponent;
  b: LogComponent;
  /** 虚线 = 间接观测通道。 */
  dashed: boolean;
}

/** SVG 视口尺寸；窄屏整图横向滚动，不压缩节点。 */
export const TOPOLOGY_VIEW_BOX = { width: 640, height: 300 } as const;

export const TOPOLOGY_NODES: readonly TopologyNodeLayout[] = [
  { id: 'browser', x: 90, y: 130, label: '浏览器' },
  { id: 'daemon', x: 270, y: 130, label: 'Daemon' },
  { id: 'codex', x: 450, y: 90, label: 'Codex' },
  { id: 'model', x: 570, y: 90, label: '模型', unattributable: true },
  { id: 'sqlite', x: 270, y: 240, label: 'SQLite' },
];

export const TOPOLOGY_CHANNELS: readonly TopologyChannelLayout[] = [
  { id: 'browser-daemon', a: 'browser', b: 'daemon', dashed: false },
  { id: 'daemon-codex', a: 'daemon', b: 'codex', dashed: false },
  { id: 'codex-model', a: 'codex', b: 'model', dashed: true },
  { id: 'daemon-sqlite', a: 'daemon', b: 'sqlite', dashed: true },
];

/** 一条静态通道叠加观测数据后的窗口统计。 */
export interface TopologyChannelStats {
  count: number;
  errorCount: number;
  /** 双向加权平均耗时（毫秒）；没有合格记录时为 null。 */
  avgDurationMs: number | null;
}

/**
 * 把服务端有向边归并进静态通道：两个方向的记录数与错误数相加，
 * 耗时按各方向记录数加权（服务端已剔除 >10_000 的长连接）。
 */
export function channelStatsOf(
  snapshot: TopologySnapshot | null,
  channel: TopologyChannelLayout,
): TopologyChannelStats {
  const edges = snapshot?.edges ?? [];
  const directions = edges.filter(
    (edge) =>
      (edge.source === channel.a && edge.target === channel.b) ||
      (edge.source === channel.b && edge.target === channel.a),
  );

  const count = directions.reduce((sum, edge) => sum + edge.count, 0);
  const errorCount = directions.reduce((sum, edge) => sum + edge.errorCount, 0);

  const weightedSum = directions.reduce(
    (sum, edge) => (edge.avgDurationMs === null ? sum : sum + edge.avgDurationMs * edge.count),
    0,
  );
  const eligibleCount = directions.reduce(
    (sum, edge) => (edge.avgDurationMs === null ? sum : sum + edge.count),
    0,
  );

  return {
    count,
    errorCount,
    avgDurationMs: eligibleCount === 0 ? null : Math.round(weightedSum / eligibleCount),
  };
}

/** 节点窗口统计；无快照时按 0 处理（图不变形）。 */
export function nodeStatsOf(
  snapshot: TopologySnapshot | null,
  nodeId: LogComponent,
): { count: number; errorCount: number } {
  const node = snapshot?.nodes.find((entry) => entry.id === nodeId);

  return { count: node?.count ?? 0, errorCount: node?.errorCount ?? 0 };
}

export function channelById(id: string): TopologyChannelLayout | undefined {
  return TOPOLOGY_CHANNELS.find((channel) => channel.id === id);
}

export function nodeById(id: LogComponent): TopologyNodeLayout | undefined {
  return TOPOLOGY_NODES.find((node) => node.id === id);
}

/** 供日志过滤复用：有向边是否落在某条通道上。 */
export function edgeMatchesChannel(
  edge: Pick<TopologyEdgeStats, 'source' | 'target'>,
  channel: TopologyChannelLayout,
): boolean {
  return (
    (edge.source === channel.a && edge.target === channel.b) ||
    (edge.source === channel.b && edge.target === channel.a)
  );
}

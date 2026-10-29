import type { AgentLog, LogComponent, TraceSummary } from '@paintcodex/protocol';
import { channelById, nodeById } from './topology-layout';

/**
 * 拓扑点击产生的过滤 chip（monitor-readability ③06）。
 * 同一时刻只有一个 chip：再点同一个节点/通道即取消；点另一个则替换。
 *
 * 状态来源：监控页共享 state（MonitorPage 的 `chip`）。③04 的追踪列表
 * 合入后由 merger 把列表接到这个 state 上；当前基线的原始日志列表已消费。
 */
export type TopologyChip =
  | { kind: 'component'; component: LogComponent }
  | { kind: 'channel'; channelId: string };

/** 点击节点/通道后的 toggle 语义：重复点击取消，不同选择替换。 */
export function toggleTopologyChip(
  current: TopologyChip | null,
  next: TopologyChip,
): TopologyChip | null {
  if (current !== null && sameChip(current, next)) {
    return null;
  }

  return next;
}

function sameChip(a: TopologyChip, b: TopologyChip): boolean {
  return a.kind === b.kind && aValue(a) === aValue(b);
}

function aValue(chip: TopologyChip): string {
  return chip.kind === 'component' ? chip.component : chip.channelId;
}

/** chip 用于列表展示的人类可读文案（用拓扑声明里的中文名）。 */
export function chipLabel(chip: TopologyChip): string {
  if (chip.kind === 'component') {
    const node = nodeById(chip.component);

    return `组件：${node?.label ?? chip.component}`;
  }

  const channel = channelById(chip.channelId);

  if (channel === undefined) {
    return `通道：${chip.channelId}`;
  }

  const a = nodeById(channel.a)?.label ?? channel.a;
  const b = nodeById(channel.b)?.label ?? channel.b;

  return `通道：${a} → ${b}`;
}

/**
 * 原始日志按 chip 过滤：组件 chip 保留发出方或接收方是该组件的记录；
 * 通道 chip 保留落在该通道双向之一上的记录。内部事件（无方向）不命中任何 chip。
 */
export function logMatchesChip(log: AgentLog, chip: TopologyChip): boolean {
  if (chip.kind === 'component') {
    return log.source === chip.component || log.target === chip.component;
  }

  const channel = channelById(chip.channelId);

  if (channel === undefined) {
    return false;
  }

  return (
    (log.source === channel.a && log.target === channel.b) ||
    (log.source === channel.b && log.target === channel.a)
  );
}

/**
 * 追踪聚合列表按 chip 过滤（接线点 C）。
 *
 * - 组件 chip：trace.components 含该组件即命中。
 * - 通道 chip：TraceSummary 只携带 components 数组、不含逐跳方向，
 *   退化为「通道两端组件都出现在 trace.components 中」即命中。
 *   这是合理近似——能在通道两端之间往返的追踪必然经过该通道；
 *   局限是无法区分单向通道，但 spec §8/ADR-0012 未要求更细粒度。
 */
export function traceMatchesChip(trace: TraceSummary, chip: TopologyChip): boolean {
  if (chip.kind === 'component') {
    return trace.components.includes(chip.component);
  }

  const channel = channelById(chip.channelId);

  if (channel === undefined) {
    return false;
  }

  return (
    trace.components.includes(channel.a) && trace.components.includes(channel.b)
  );
}

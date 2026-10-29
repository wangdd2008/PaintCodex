import type { AgentLog, LogComponent } from '@paintcodex/protocol';
import { channelById } from './topology-layout';

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

/** chip 用于列表展示的人类可读文案。 */
export function chipLabel(chip: TopologyChip): string {
  if (chip.kind === 'component') {
    return `组件：${chip.component}`;
  }

  const channel = channelById(chip.channelId);

  return channel ? `通道：${channel.a} → ${channel.b}` : `通道：${chip.channelId}`;
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

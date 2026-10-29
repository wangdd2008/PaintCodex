import type { AgentLog, TopologySnapshot } from '@paintcodex/protocol';
import { describe, expect, it } from 'vitest';
import {
  channelStatsOf,
  nodeStatsOf,
  TOPOLOGY_CHANNELS,
} from '../src/features/monitor/topology-layout';
import {
  chipLabel,
  logMatchesChip,
  toggleTopologyChip,
} from '../src/features/monitor/topology-filter';

function makeSnapshot(overrides: Partial<TopologySnapshot> = {}): TopologySnapshot {
  return {
    windowMs: 300_000,
    nodes: [],
    edges: [],
    ...overrides,
  };
}

function makeLog(overrides: Partial<AgentLog> = {}): AgentLog {
  return {
    id: 1,
    traceId: null,
    spanId: null,
    parentId: null,
    timestamp: 1_000,
    level: 'info',
    category: 'system',
    message: 'event',
    payload: null,
    durationMs: null,
    error: null,
    canvasId: null,
    revision: null,
    actor: null,
    source: null,
    target: null,
    ...overrides,
  };
}

describe('channelStatsOf', () => {
  const browserDaemon = TOPOLOGY_CHANNELS.find((c) => c.id === 'browser-daemon');

  it('把双向有向边相加，耗时按记录数加权', () => {
    const snapshot = makeSnapshot({
      edges: [
        { source: 'browser', target: 'daemon', count: 2, errorCount: 1, avgDurationMs: 100 },
        { source: 'daemon', target: 'browser', count: 1, errorCount: 0, avgDurationMs: 400 },
      ],
    });

    const stats = channelStatsOf(snapshot, browserDaemon!);

    expect(stats).toEqual({ count: 3, errorCount: 1, avgDurationMs: Math.round((100 * 2 + 400 * 1) / 3) });
  });

  it('没有合格耗时记录时 avgDurationMs 为 null', () => {
    const snapshot = makeSnapshot({
      edges: [
        { source: 'browser', target: 'daemon', count: 1, errorCount: 0, avgDurationMs: null },
      ],
    });

    expect(channelStatsOf(snapshot, browserDaemon!)).toEqual({
      count: 1,
      errorCount: 0,
      avgDurationMs: null,
    });
  });

  it('无快照时按 0 处理，图不变形', () => {
    expect(channelStatsOf(null, browserDaemon!)).toEqual({
      count: 0,
      errorCount: 0,
      avgDurationMs: null,
    });
  });
});

describe('nodeStatsOf', () => {
  it('从快照取节点数字；无快照为 0', () => {
    const snapshot = makeSnapshot({
      nodes: [{ id: 'daemon', count: 5, errorCount: 1 }],
    });

    expect(nodeStatsOf(snapshot, 'daemon')).toEqual({ count: 5, errorCount: 1 });
    expect(nodeStatsOf(null, 'browser')).toEqual({ count: 0, errorCount: 0 });
  });
});

describe('toggleTopologyChip', () => {
  it('再点同一个节点取消；点另一个组件替换', () => {
    const onDaemon = { kind: 'component', component: 'daemon' } as const;

    expect(toggleTopologyChip(null, onDaemon)).toEqual(onDaemon);
    expect(toggleTopologyChip(onDaemon, onDaemon)).toBeNull();

    const onBrowser = { kind: 'component', component: 'browser' } as const;
    expect(toggleTopologyChip(onDaemon, onBrowser)).toEqual(onBrowser);
  });

  it('组件 chip 与通道 chip 互斥（同一时刻只有一个）', () => {
    const onDaemon = { kind: 'component', component: 'daemon' } as const;
    const onChannel = { kind: 'channel', channelId: 'daemon-sqlite' } as const;

    expect(toggleTopologyChip(onDaemon, onChannel)).toEqual(onChannel);
    expect(toggleTopologyChip(onChannel, onChannel)).toBeNull();
  });

  it('chipLabel 生成可读文案', () => {
    expect(chipLabel({ kind: 'component', component: 'daemon' })).toBe('组件：daemon');
    expect(chipLabel({ kind: 'channel', channelId: 'browser-daemon' })).toBe(
      '通道：browser → daemon',
    );
  });
});

describe('logMatchesChip', () => {
  it('组件 chip 保留发出方或接收方是该组件的记录', () => {
    const chip = { kind: 'component', component: 'daemon' } as const;

    expect(logMatchesChip(makeLog({ source: 'browser', target: 'daemon' }), chip)).toBe(true);
    expect(logMatchesChip(makeLog({ source: 'daemon', target: 'codex' }), chip)).toBe(true);
    expect(logMatchesChip(makeLog({ source: 'browser', target: 'browser' }), chip)).toBe(false);
  });

  it('通道 chip 保留落在该通道双向之一的记录；内部事件不命中', () => {
    const chip = { kind: 'channel', channelId: 'browser-daemon' } as const;

    expect(logMatchesChip(makeLog({ source: 'browser', target: 'daemon' }), chip)).toBe(true);
    expect(logMatchesChip(makeLog({ source: 'daemon', target: 'browser' }), chip)).toBe(true);
    expect(logMatchesChip(makeLog({ source: 'daemon', target: 'codex' }), chip)).toBe(false);
    // 内部事件（无方向）不命中任何 chip。
    expect(logMatchesChip(makeLog(), chip)).toBe(false);
  });
});

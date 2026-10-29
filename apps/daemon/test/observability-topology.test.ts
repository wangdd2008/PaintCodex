import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/storage/database.js';
import { AgentLogRepository } from '../src/observability/repository.js';

function createRepository(): AgentLogRepository {
  return new AgentLogRepository(openDatabase(':memory:'));
}

describe('AgentLogRepository.summarizeTopology', () => {
  it('按组件聚合窗口内触碰的记录数与错误数，nodes 恒为五个组件', () => {
    const repository = createRepository();

    // browser → daemon：2 条，其中 1 条 error。
    repository.insert({ timestamp: 1_000, category: 'http', message: 'http_request', source: 'browser', target: 'daemon' });
    repository.insert({ timestamp: 1_100, level: 'error', category: 'http', message: 'http_request', source: 'browser', target: 'daemon', error: 'boom' });
    // daemon → browser：1 条，带耗时 200ms。
    repository.insert({ timestamp: 1_200, category: 'sse', message: 'sse_publish', source: 'daemon', target: 'browser', durationMs: 200 });
    // daemon → codex：1 条，耗时 500ms。
    repository.insert({ timestamp: 1_300, category: 'codex-runtime', message: 'turn_start', source: 'daemon', target: 'codex', durationMs: 500 });
    // 内部事件：没有方向，不进图。
    repository.insert({ timestamp: 1_400, category: 'system', message: 'startup' });

    const snapshot = repository.summarizeTopology({ now: 2_000, windowMs: 5_000 });

    expect(snapshot.windowMs).toBe(5_000);
    expect(snapshot.nodes.map((node) => node.id)).toEqual([
      'browser',
      'daemon',
      'codex',
      'model',
      'sqlite',
    ]);

    const nodeOf = (id: string) => snapshot.nodes.find((node) => node.id === id);

    // browser 被 3 条记录触碰（2 条发出 + 1 条接收），其中 1 条 error。
    expect(nodeOf('browser')).toMatchObject({ count: 3, errorCount: 1 });
    expect(nodeOf('daemon')).toMatchObject({ count: 4, errorCount: 1 });
    expect(nodeOf('codex')).toMatchObject({ count: 1, errorCount: 0 });
    // model / sqlite 窗口内没有方向记录：数字为 0，节点照常存在。
    expect(nodeOf('model')).toMatchObject({ count: 0, errorCount: 0 });
    expect(nodeOf('sqlite')).toMatchObject({ count: 0, errorCount: 0 });
  });

  it('edges 按有向对聚合，含 count / errorCount / avgDurationMs', () => {
    const repository = createRepository();

    repository.insert({ timestamp: 1_000, category: 'http', message: 'http_request', source: 'browser', target: 'daemon', durationMs: 100 });
    repository.insert({ timestamp: 1_100, level: 'error', category: 'http', message: 'http_request', source: 'browser', target: 'daemon', durationMs: 300 });
    repository.insert({ timestamp: 1_200, category: 'sse', message: 'sse_publish', source: 'daemon', target: 'browser', durationMs: 200 });

    const snapshot = repository.summarizeTopology({ now: 2_000, windowMs: 5_000 });

    expect(snapshot.edges).toEqual([
      { source: 'browser', target: 'daemon', count: 2, errorCount: 1, avgDurationMs: 200 },
      { source: 'daemon', target: 'browser', count: 1, errorCount: 0, avgDurationMs: 200 },
    ]);
  });

  it('平均耗时排除 durationMs > 10_000 的长连接；恰好 10_000 计入', () => {
    const repository = createRepository();

    repository.insert({ timestamp: 1_000, category: 'sse', message: 'sse_publish', source: 'daemon', target: 'browser', durationMs: 100 });
    // SSE 长连接：30_000ms 不应进入平均。
    repository.insert({ timestamp: 1_100, category: 'sse', message: 'sse_publish', source: 'daemon', target: 'browser', durationMs: 30_000 });
    // 边界：恰好 10_000 计入平均。
    repository.insert({ timestamp: 1_200, category: 'sse', message: 'sse_publish', source: 'daemon', target: 'browser', durationMs: 10_000 });

    const snapshot = repository.summarizeTopology({ now: 2_000, windowMs: 5_000 });

    const edge = snapshot.edges.find(
      (entry) => entry.source === 'daemon' && entry.target === 'browser',
    );
    expect(edge).toMatchObject({ count: 3, avgDurationMs: 5_050 });
  });

  it('通道有消息但没有合格耗时记录时 avgDurationMs 为 null', () => {
    const repository = createRepository();

    // 无耗时的点事件。
    repository.insert({ timestamp: 1_000, category: 'sse', message: 'sse_subscribe', source: 'browser', target: 'daemon' });
    // 只有一条超长记录，被排除。
    repository.insert({ timestamp: 1_100, category: 'sse', message: 'sse_publish', source: 'daemon', target: 'browser', durationMs: 60_000 });

    const snapshot = repository.summarizeTopology({ now: 2_000, windowMs: 5_000 });

    expect(snapshot.edges.find((entry) => entry.source === 'browser' && entry.target === 'daemon'))
      .toMatchObject({ count: 1, avgDurationMs: null });
    expect(snapshot.edges.find((entry) => entry.source === 'daemon' && entry.target === 'browser'))
      .toMatchObject({ count: 1, avgDurationMs: null });
  });

  it('只聚合窗口内的记录；空窗口返回全 0 节点与空 edges', () => {
    const repository = createRepository();

    // since = 6000 - 5000 = 100：timestamp 50 在窗外，5000 在窗内。
    repository.insert({ timestamp: 50, category: 'http', message: 'old', source: 'browser', target: 'daemon' });
    repository.insert({ timestamp: 5_000, category: 'http', message: 'new', source: 'browser', target: 'daemon' });

    const snapshot = repository.summarizeTopology({ now: 6_000, windowMs: 5_000 });

    expect(snapshot.nodes.find((node) => node.id === 'browser')).toMatchObject({ count: 1 });
    expect(snapshot.edges).toEqual([
      { source: 'browser', target: 'daemon', count: 1, errorCount: 0, avgDurationMs: null },
    ]);

    const emptyRepository = createRepository();
    const empty = emptyRepository.summarizeTopology({ now: 6_000, windowMs: 5_000 });

    expect(empty.nodes.every((node) => node.count === 0 && node.errorCount === 0)).toBe(true);
    expect(empty.edges).toEqual([]);
  });
});

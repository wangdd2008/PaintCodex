import type { AgentLog, AgentTrace, AgentTraceNode, LogComponent } from '@paintcodex/protocol';
import { describe, expect, it } from 'vitest';
import { buildSequence, formatRelativeOffset } from '../src/features/monitor/trace-sequence';

/**
 * 手算 fixture：一条 HTTP 请求触发一次 AI 对话的最小完整链。
 * 时间戳从 1000 起，逐条手工算好 offsetMs 与组件列顺序，
 * 断言直接写死这些字面量，不靠实现反推。
 */
function makeLog(id: number, overrides: Partial<AgentLog> = {}): AgentLog {
  return {
    id,
    traceId: 'trace-1',
    spanId: `span-${id}`,
    parentId: null,
    timestamp: 1000 + id * 10,
    level: 'info',
    category: 'system',
    message: `event ${id}`,
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

function node(log: AgentLog, children: AgentTraceNode[] = []): AgentTraceNode {
  return { log, children };
}

/**
 * 手工搭一棵小树：http(1) → turn(2) → tool(3) → layer(4)；
 * sse(5) 挂在 http 下；system(6) 作为另一个根。
 */
function makeTrace(): AgentTrace {
  const layer = makeLog(4, {
    category: 'canvas-action',
    message: 'layer_update',
    source: 'daemon',
    target: 'sqlite',
    durationMs: 5,
  });
  const tool = makeLog(3, {
    category: 'canvas-tool',
    message: 'tool_call',
    source: 'codex',
    target: 'daemon',
    durationMs: 40,
  });
  tool.spanId = 'span-3';
  tool.parentId = 'span-2';
  layer.parentId = 'span-3';
  layer.spanId = 'span-4';
  const turn = makeLog(2, {
    category: 'ai-chat',
    message: 'turn_start',
    source: 'daemon',
    target: 'codex',
    durationMs: 500,
  });
  turn.spanId = 'span-2';
  turn.parentId = 'span-1';
  const sse = makeLog(5, {
    category: 'sse',
    message: 'sse_publish',
    source: 'daemon',
    target: 'browser',
  });
  sse.parentId = 'span-1';
  sse.spanId = 'span-5';
  const http = makeLog(1, {
    category: 'http',
    message: 'http_request',
    source: 'browser',
    target: 'daemon',
  });
  http.spanId = 'span-1';
  const sys = makeLog(6, { category: 'system', message: 'system' });

  return {
    traceId: 'trace-1',
    roots: [node(http, [node(turn, [node(tool, [node(layer)])]), node(sse)]), node(sys)],
  };
}

describe('buildSequence', () => {
  it('orders columns by first appearance across the timestamp-sorted walk', () => {
    const model = buildSequence(makeTrace());

    // http(1) 先出现 browser,daemon；turn(2) 带出 codex；layer(4) 带出 sqlite。
    // system(6) 无方向，落在 daemon 列，不新增列。
    expect(model.columns).toEqual(['browser', 'daemon', 'codex', 'sqlite']);
  });

  it('flattens the tree and orders entries by timestamp ascending', () => {
    const model = buildSequence(makeTrace());

    expect(model.entries.map((entry) => entry.log.id)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('classifies a directed record as an arrow with source -> target', () => {
    const model = buildSequence(makeTrace());
    const turn = model.entries.find((entry) => entry.log.id === 2);

    expect(turn?.kind).toBe('arrow');
    if (turn?.kind !== 'arrow') {
      throw new Error('turn should be an arrow entry');
    }

    expect(turn.from).toBe('daemon');
    expect(turn.to).toBe('codex');
    expect(turn.durationMs).toBe(500);
    // turn 时间戳 1020，startTime 1010（id1），offset = 10。
    expect(turn.offsetMs).toBe(10);
  });

  it('renders a directionless internal record as a dot on its own component lane', () => {
    const model = buildSequence(makeTrace());
    const sys = model.entries.find((entry) => entry.log.id === 6);

    expect(sys?.kind).toBe('dot');
    if (sys?.kind !== 'dot') {
      throw new Error('system record should be a dot entry');
    }

    // system 由 daemon 发出，落在 daemon 列。
    expect(sys.lane).toBe('daemon');
  });

  it('never crashes on a record missing one direction endpoint', () => {
    const halfSource = makeLog(7, { source: 'browser', target: null, message: 'half-source' });
    const halfTarget = makeLog(8, { source: null, target: 'codex', message: 'half-target' });
    const trace: AgentTrace = {
      traceId: 'trace-2',
      roots: [node(halfSource), node(halfTarget)],
    };

    const model = buildSequence(trace);

    // 缺端点不画箭头，退化为已知端点列上的圆点，且不把 NULL 当组件。
    const sourceDot = model.entries.find((entry) => entry.log.id === 7);
    const targetDot = model.entries.find((entry) => entry.log.id === 8);

    expect(sourceDot?.kind).toBe('dot');
    expect(targetDot?.kind).toBe('dot');
    if (sourceDot?.kind !== 'dot' || targetDot?.kind !== 'dot') {
      throw new Error('half-direction records should degrade to dots');
    }

    expect(sourceDot.lane).toBe('browser');
    expect(targetDot.lane).toBe('codex');
    expect(model.columns).toEqual(['browser', 'codex']);
    expect(model.columns).not.toContain(null);
  });

  it('derives an internal codex-runtime event onto the codex lane', () => {
    const runtime = makeLog(9, {
      category: 'codex-runtime',
      message: 'runtime_error',
      source: null,
      target: null,
    });
    const model = buildSequence({ traceId: 'trace-3', roots: [node(runtime)] });

    const entry = model.entries[0];
    expect(entry?.kind).toBe('dot');
    if (entry?.kind !== 'dot') {
      throw new Error('runtime error should be a dot');
    }

    expect(entry.lane).toBe('codex');
    expect(model.columns).toEqual(['codex']);
  });

  it('handles an empty trace', () => {
    const model = buildSequence({ traceId: 'empty', roots: [] });

    expect(model.columns).toEqual([]);
    expect(model.entries).toEqual([]);
    expect(model.startTime).toBe(0);
    expect(model.endTime).toBe(0);
  });

  it('does not mutate the input trace', () => {
    const trace = makeTrace();
    const snapshot = JSON.stringify(trace);
    buildSequence(trace);
    expect(JSON.stringify(trace)).toBe(snapshot);
  });
});

describe('formatRelativeOffset', () => {
  it('labels the start as +0ms', () => {
    expect(formatRelativeOffset(0)).toBe('+0ms');
  });

  it('labels later times as a positive offset', () => {
    expect(formatRelativeOffset(123)).toBe('+123ms');
    expect(formatRelativeOffset(1234)).toBe('+1234ms');
  });

  it('rounds fractional offsets', () => {
    expect(formatRelativeOffset(12.6)).toBe('+13ms');
  });
});

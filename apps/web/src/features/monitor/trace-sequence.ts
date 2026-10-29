import type {
  AgentLog,
  AgentTrace,
  AgentTraceNode,
  LogCategory,
  LogComponent,
} from '@paintcodex/protocol';

/**
 * 时序图布局模型（monitor-readability ③05）。
 *
 * 这是「数据 → 布局」的纯函数 seam：只吃 `GET /monitor/traces/:traceId`
 * 返回的树，吐出横轴组件列与按时间排好的记录项，不碰 DOM、不读时钟。
 * SVG 渲染层只负责把这里算出的列与项画出来，便于单测覆盖分列与排序。
 */

/** 一条有方向的记录：画成 source → target 的箭头。 */
export interface SequenceArrow {
  kind: 'arrow';
  log: AgentLog;
  from: LogComponent;
  to: LogComponent;
  /** 相对 startTime 的毫秒偏移，用于纵轴定位。 */
  offsetMs: number;
  durationMs: number | null;
}

/** 无方向记录（内部事件）或方向端点缺失的记录：画成某组件列上的圆点。 */
export interface SequenceDot {
  kind: 'dot';
  log: AgentLog;
  /** 圆点落在哪一组件列。 */
  lane: LogComponent;
  offsetMs: number;
}

export type SequenceEntry = SequenceArrow | SequenceDot;

export interface SequenceModel {
  /** 横轴组件列，按在时间线中首次出现的先后去重排序。 */
  columns: LogComponent[];
  /** 按 timestamp 升序（同分按 id）的全部记录项。 */
  entries: SequenceEntry[];
  /** 最早记录的时间戳；空追踪为 0。 */
  startTime: number;
  /** 最后一条记录的结束时间戳（含 durationMs）；空追踪为 0。 */
  endTime: number;
}

/**
 * 内部事件（无 source/target）归到哪个组件列。
 *
 * 方向映射表里，真正落库为 NULL 的只有 `system`（daemon 启动、库迁移）
 * 与 `codex-runtime` 的进程错误。前者归 daemon，后者归 codex；其余分类
 * 理论上都已带方向，这里兜底归 daemon，宁可画在一列上也不新增未知列。
 */
function internalLane(category: LogCategory): LogComponent {
  return category === 'codex-runtime' ? 'codex' : 'daemon';
}

/** 把追踪树拍平成记录列表（树结构只用于层级视图，时序图按时间重排）。 */
function flatten(tree: AgentTraceNode[]): AgentLog[] {
  const out: AgentLog[] = [];
  const walk = (nodes: AgentTraceNode[]): void => {
    for (const node of nodes) {
      out.push(node.log);
      walk(node.children);
    }
  };
  walk(tree);
  return out;
}

/**
 * 由一棵树算出时序图布局。
 *
 * - 列顺序：按时间升序遍历，把每条记录的端点（或内部落点组件）
 *   按首次出现记入列表——与追踪摘要 `components` 同口径。
 * - 有 source 且有 target → 箭头；缺任一端点或都缺 → 退化为圆点，
 *   缺端点取已知端点列，都缺按分类归内部列，绝不因脏数据崩图。
 */
export function buildSequence(trace: AgentTrace): SequenceModel {
  const logs = flatten(trace.roots).sort(
    (a, b) => a.timestamp - b.timestamp || a.id - b.id,
  );

  const first = logs[0];
  if (first === undefined) {
    return { columns: [], entries: [], startTime: 0, endTime: 0 };
  }

  const startTime = first.timestamp;
  let endTime = startTime;
  const columns: LogComponent[] = [];
  const seen = new Set<LogComponent>();
  const entries: SequenceEntry[] = [];

  const remember = (component: LogComponent): void => {
    if (!seen.has(component)) {
      seen.add(component);
      columns.push(component);
    }
  };

  for (const log of logs) {
    const offsetMs = log.timestamp - startTime;
    const end = log.timestamp + (log.durationMs ?? 0);
    if (end > endTime) {
      endTime = end;
    }

    const { source, target } = log;

    if (source !== null && target !== null) {
      remember(source);
      remember(target);
      entries.push({ kind: 'arrow', log, from: source, to: target, offsetMs, durationMs: log.durationMs });
      continue;
    }

    // 方向不完整：缺一边用已知端点列，两边都缺按分类归内部列。
    const lane = source ?? target ?? internalLane(log.category);
    remember(lane);
    entries.push({ kind: 'dot', log, lane, offsetMs });
  }

  return { columns, entries, startTime, endTime };
}

/**
 * 纵轴相对时间标签：从追踪起点算起的毫秒数。
 * 跨度过大时不显示绝对时钟，只显示 `+123ms`，避免标签挤压图面。
 */
export function formatRelativeOffset(offsetMs: number): string {
  const rounded = Math.round(offsetMs);
  return `+${Math.max(0, rounded)}ms`;
}

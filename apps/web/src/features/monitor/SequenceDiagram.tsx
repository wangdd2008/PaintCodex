import type { AgentLog, LogComponent } from '@paintcodex/protocol';
import { COMPONENT_LABELS } from './monitor-format';
import { formatRelativeOffset, type SequenceModel } from './trace-sequence';

interface SequenceDiagramProps {
  model: SequenceModel;
  selectedLogId: number | null;
  onSelect: (log: AgentLog) => void;
}

/** 时序图布局常量：组件列等宽，行高固定；列多了靠外层横向滚动，不压字号。 */
const GUTTER = 76;
const COL_W = 150;
const HEADER_H = 30;
const ROW_H = 38;
/** durationMs → 激活条高度的换算系数；长耗时也封顶在两行内。 */
const PX_PER_MS = 0.2;
const MIN_ACTIVE_H = 6;
const MAX_ACTIVE_H = ROW_H * 1.6;

function columnX(index: number): number {
  return GUTTER + index * COL_W + COL_W / 2;
}

/**
 * 追踪内部时序图（monitor-readability ③05）。
 *
 * 横轴＝组件列（顺序取 buildSequence 算出的 columns），纵轴＝时间
 * （行按 timestamp 升序）。有方向的记录画成 source→target 箭头，
 * 箭头旁写 message；带 durationMs 的在目标列上叠一条按耗时定高的
 * 激活条；无方向记录画成组件列上的圆点。手写 SVG，不引入图表库。
 */
export function SequenceDiagram({ model, selectedLogId, onSelect }: SequenceDiagramProps) {
  const { columns, entries } = model;
  const width = GUTTER + columns.length * COL_W;
  const height = HEADER_H + entries.length * ROW_H + 16;
  const columnIndex = new Map<LogComponent, number>(columns.map((c, i) => [c, i]));

  return (
    <div className="seq-scroll">
      <svg
        className="seq-diagram"
        width={width}
        height={height}
        role="img"
        aria-label="追踪时序图"
      >
        <defs>
          <marker
            id="seq-arrowhead"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#8fb8ff" />
          </marker>
        </defs>

        {/* 列头：组件名 */}
        {columns.map((component, i) => (
          <text
            key={component}
            className="seq-col-label"
            x={columnX(i)}
            y={18}
            textAnchor="middle"
          >
            {COMPONENT_LABELS[component]}
          </text>
        ))}

        {/* 每条生命线：从列头下拉到底 */}
        {columns.map((component, i) => (
          <line
            key={`lane-${component}`}
            className="seq-lifeline"
            x1={columnX(i)}
            y1={HEADER_H}
            x2={columnX(i)}
            y2={height - 8}
          />
        ))}

        {entries.map((entry, row) => {
          const y = HEADER_H + row * ROW_H + ROW_H / 2;
          const selected = entry.log.id === selectedLogId;

          // 相对时间刻度（纵轴标签）
          const timeLabel = (
            <text key={`t-${entry.log.id}`} className="seq-time" x={8} y={y + 4}>
              {formatRelativeOffset(entry.offsetMs)}
            </text>
          );

          if (entry.kind === 'arrow') {
            const fromIdx = columnIndex.get(entry.from) ?? 0;
            const toIdx = columnIndex.get(entry.to) ?? fromIdx;
            const x1 = columnX(fromIdx);
            const x2 = columnX(toIdx);
            const leftToRight = x2 >= x1;
            const labelX = leftToRight ? x2 + 8 : x2 - 8;
            const labelAnchor = leftToRight ? 'start' : 'end';
            const activeH =
              entry.durationMs !== null && entry.durationMs > 0
                ? Math.min(MAX_ACTIVE_H, Math.max(MIN_ACTIVE_H, entry.durationMs * PX_PER_MS))
                : 0;

            return (
              <g
                key={entry.log.id}
                className={`seq-entry ${selected ? 'seq-entry--selected' : ''}`}
                onClick={() => onSelect(entry.log)}
                data-testid="seq-arrow"
                data-log-id={entry.log.id}
                data-from={entry.from}
                data-to={entry.to}
              >
                {timeLabel}
                {activeH > 0 ? (
                  <rect
                    className="seq-activation"
                    x={x2 - 3}
                    y={y}
                    width={6}
                    height={activeH}
                  />
                ) : null}
                <line
                  className="seq-message-line"
                  x1={x1}
                  y1={y}
                  x2={x2}
                  y2={y}
                  markerEnd="url(#seq-arrowhead)"
                />
                <text className="seq-message" x={labelX} y={y - 4} textAnchor={labelAnchor}>
                  {entry.log.message}
                </text>
              </g>
            );
          }

          // 无方向记录（内部事件 / 方向端点缺失）：落在对应组件列上的圆点。
          const laneIdx = columnIndex.get(entry.lane) ?? 0;
          const cx = columnX(laneIdx);
          return (
            <g
              key={entry.log.id}
              className={`seq-entry ${selected ? 'seq-entry--selected' : ''}`}
              onClick={() => onSelect(entry.log)}
              data-testid="seq-dot"
              data-log-id={entry.log.id}
              data-lane={entry.lane}
            >
              {timeLabel}
              <circle className="seq-dot" cx={cx} cy={y} r={4} />
              <text className="seq-message" x={cx + 8} y={y - 4} textAnchor="start">
                {entry.log.message}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

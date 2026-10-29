import { TraceView } from './TraceView';

/**
 * 追踪展开区（monitor-readability ③04 占位 → ③05 正式接线）。
 *
 * ③04 只负责「点击一行、在同页内展开」的交互契约；本展开区直接渲染
 * ③05 的 TraceView（时序图/层级树/明细三态）。关闭按钮等价于再次点击
 * 该行收起展开区。
 */
export function TraceTimelinePane({
  traceId,
  onClose,
}: {
  traceId: string;
  onClose: () => void;
}) {
  return <TraceView traceId={traceId} onClose={onClose} />;
}

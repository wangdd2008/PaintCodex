/**
 * 追踪时序的占位组件——monitor-readability ③05 的扩展点。
 *
 * 本票只负责「点击一行、在同页内展开」的交互契约；时序图（横轴组件、纵轴
 * 时间、按 durationMs 画箭头）由 ③05 实现并替换本组件。导出名保持稳定，
 * ③05 直接在展开行内替换即可。
 */
export function TraceTimelinePane({ traceId }: { traceId: string }) {
  return (
    <div className="trace-timeline" data-trace-id={traceId}>
      <p className="monitor-muted">
        追踪时序视图将在后续版本实现（③05）；当前为占位区域。
      </p>
    </div>
  );
}

import type { AgentLog } from '@paintcodex/protocol';

interface LogDetailProps {
  log: AgentLog | null;
}

/**
 * 追踪明细（monitor-readability ③04）。
 *
 * 【占位实现】③04 与本票并行，开工时它尚未合入。这里先按 spec §6
 * 的最低要求——把 payload 原样渲染成 JSON——让时序图/层级树的
 * 「点击看明细」可端到端点击。待 ③04 合入后，由 merger 用正式的
 * 「标签：值」渲染替换本文件。
 */
export function LogDetail({ log }: LogDetailProps) {
  if (log === null) {
    return (
      <div className="log-detail log-detail--empty monitor-empty">
        点击时序图或层级树中的任一记录，在此查看其明细。
      </div>
    );
  }

  return (
    <div className="log-detail">
      <div className="log-detail__head">
        <span className="log-detail__message" title={log.message}>
          {log.message}
        </span>
        <span className="level-badge" data-level={log.level}>
          {log.level}
        </span>
      </div>
      {/* 占位：正式版按 spec §6 的已知键表渲染「标签：值」，未知键才回落 JSON。 */}
      <pre className="log-detail__payload">{JSON.stringify(log.payload, null, 2)}</pre>
    </div>
  );
}

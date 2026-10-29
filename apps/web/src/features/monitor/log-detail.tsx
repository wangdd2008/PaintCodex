import { describePayloadFields, truncateJson } from './log-format';

interface LogDetailProps {
  /** 记录的 payload（已由 repository/路由 JSON.parse 成对象或原样字符串）。 */
  payload: unknown;
  /** 记录自带的错误文本；有则展示在明细上方。 */
  error?: string | null;
}

/**
 * 单条日志的 payload 明细（monitor-readability ③04 / spec §6）。
 *
 * 「监控看不懂」的第一原因是 payload 从未被渲染：http_request 的
 * method/path/statusCode、工具调用的 tool/ok 全躺在 payload 里。本组件把
 * 已知键渲染成「标签：值」，白名单之外的键折叠进原始 JSON——payload 入库
 * 时不截断，截断只发生在这个渲染层（2000 字符）。
 *
 * ③05（时序图）点击节点时会复用本组件显示该节点明细，导出名保持稳定。
 */
export function LogDetail({ payload, error }: LogDetailProps) {
  if (payload === null || payload === undefined) {
    return <p className="log-detail__empty">无 payload 明细</p>;
  }

  const { known, unknownKeys } = describePayloadFields(payload);
  const rawJson = JSON.stringify(payload, null, 2);
  const fallback = truncateJson(rawJson);
  const hasUnknown = unknownKeys.length > 0;

  return (
    <div className="log-detail">
      {error ? <p className="log-detail__error">{error}</p> : null}

      {known.length > 0 ? (
        <dl className="log-detail__fields">
          {known.map((field) => (
            <div className="log-detail__field" key={field.key}>
              <dt>{field.label}</dt>
              <dd title={field.value}>{field.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {hasUnknown ? (
        <details className="log-detail__raw">
          <summary>原始 JSON</summary>
          <pre>{fallback.text}</pre>
          {fallback.truncated ? (
            <p className="log-detail__truncated">
              已截断（完整 payload 共 {rawJson.length} 字符，入库数据未截断）
            </p>
          ) : null}
        </details>
      ) : null}

      {known.length === 0 && !hasUnknown ? (
        <p className="log-detail__empty">无 payload 明细</p>
      ) : null}
    </div>
  );
}

import type { LogComponent } from '@paintcodex/protocol';

/**
 * 组件词表的界面说法。协议词表（browser/daemon/codex/model/sqlite）保持
 * 机器可读，这里只把展示文字中文化——组件路径与方向列共用同一份标签。
 */
export const COMPONENT_LABELS: Record<LogComponent, string> = {
  browser: '浏览器',
  daemon: 'Daemon',
  codex: 'Codex',
  model: '模型',
  sqlite: 'SQLite',
};

/**
 * 追踪列表的「组件路径」：来自 `TraceSummary.components`（去重、按首次出现
 * 排序），渲染成 `浏览器 → Daemon → Codex`。
 */
export function formatComponentPath(components: readonly LogComponent[]): string {
  if (components.length === 0) {
    return '—';
  }

  return components.map((component) => COMPONENT_LABELS[component]).join(' → ');
}

/**
 * 一条记录的方向列：有 source/target 显示 `源 → 目标`；两端皆 NULL 的内部
 * 事件显示「内部」——它本来就不过任何通道，不是「未知」（ADR-0012）。
 */
export function formatDirection(
  source: LogComponent | null,
  target: LogComponent | null,
): string {
  if (source === null && target === null) {
    return '内部';
  }

  return `${componentLabel(source)} → ${componentLabel(target)}`;
}

function componentLabel(component: LogComponent | null): string {
  return component === null ? '—' : COMPONENT_LABELS[component];
}

/**
 * payload 明细的已知键白名单（monitor-readability ③04 / spec §6）。
 * 顺序即渲染顺序；未知键一律回落为可折叠原始 JSON。
 */
export const KNOWN_PAYLOAD_FIELDS: ReadonlyArray<readonly [key: string, label: string]> = [
  ['method', '方法'],
  ['path', '路径'],
  ['statusCode', '状态码'],
  ['tool', '工具'],
  ['ok', '结果'],
  ['argumentSummary', '参数摘要'],
  ['layerId', '图层'],
  ['code', '错误码'],
  ['deltaCount', '增量数'],
  ['outputLength', '输出长度'],
  ['assistantLength', '回复长度'],
  ['toolCallCount', '工具调用数'],
  ['promptLength', '提示长度'],
  ['layerCount', '图层数'],
  ['hasCanvas', '有无画布'],
  ['revision', '修订号'],
  ['event', '事件'],
];

export interface PayloadField {
  key: string;
  label: string;
  value: string;
}

export interface DescribedPayload {
  known: PayloadField[];
  /** 白名单之外的键，交给折叠的原始 JSON 兜底。 */
  unknownKeys: string[];
}

/**
 * 把 payload 拆成「已知键行」与「未知键」两堆。只有普通对象才拆；字符串、
 * 数字、null 一律当作无已知键——由组件整体回落为原始 JSON。
 */
export function describePayloadFields(payload: unknown): DescribedPayload {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { known: [], unknownKeys: [] };
  }

  const record = payload as Record<string, unknown>;
  const knownKeys = new Set(KNOWN_PAYLOAD_FIELDS.map(([key]) => key));
  const known: PayloadField[] = [];
  const unknownKeys: string[] = [];

  for (const [key, label] of KNOWN_PAYLOAD_FIELDS) {
    if (key in record) {
      known.push({ key, label, value: formatKnownValue(key, record[key]) });
    }
  }

  for (const key of Object.keys(record)) {
    if (!knownKeys.has(key)) {
      unknownKeys.push(key);
    }
  }

  return { known, unknownKeys };
}

/** 已知键的人读化：hasCanvas → 有/无，其余布尔 → 是/否，非布尔按原样字符串。 */
function formatKnownValue(key: string, value: unknown): string {
  if (typeof value === 'boolean') {
    if (key === 'hasCanvas') {
      return value ? '有' : '无';
    }

    return value ? '是' : '否';
  }

  if (typeof value === 'string') {
    return value;
  }

  return String(value);
}

export interface TruncatedJson {
  text: string;
  truncated: boolean;
}

/**
 * 渲染层截断：payload 入库时不截断，只在展示兜底 JSON 时裁到 `limit`
 * 字符并由组件标注「已截断」。
 */
export function truncateJson(json: string, limit = 2_000): TruncatedJson {
  if (json.length <= limit) {
    return { text: json, truncated: false };
  }

  return { text: json.slice(0, limit), truncated: true };
}

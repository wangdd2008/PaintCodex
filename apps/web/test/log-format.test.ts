import { describe, expect, it } from 'vitest';
import {
  describePayloadFields,
  formatComponentPath,
  formatDirection,
  truncateJson,
} from '../src/features/monitor/log-format';

describe('formatComponentPath', () => {
  it('joins components into a Chinese arrow path', () => {
    expect(formatComponentPath(['browser', 'daemon', 'codex'])).toBe(
      '浏览器 → Daemon → Codex',
    );
  });

  it('keeps the order of first appearance', () => {
    expect(formatComponentPath(['daemon', 'sqlite', 'browser'])).toBe(
      'Daemon → SQLite → 浏览器',
    );
  });

  it('renders an empty path as a dash', () => {
    expect(formatComponentPath([])).toBe('—');
  });
});

describe('formatDirection', () => {
  it('renders source and target with Chinese labels', () => {
    expect(formatDirection('daemon', 'browser')).toBe('Daemon → 浏览器');
    expect(formatDirection('codex', 'daemon')).toBe('Codex → Daemon');
  });

  it('renders a null direction as 内部', () => {
    expect(formatDirection(null, null)).toBe('内部');
  });

  it('shows a dash for the missing endpoint when only one side is null', () => {
    expect(formatDirection('daemon', null)).toBe('Daemon → —');
  });
});

describe('describePayloadFields', () => {
  it('maps known keys to Chinese labels with human values', () => {
    const result = describePayloadFields({
      method: 'POST',
      path: '/paint/canvas',
      statusCode: 200,
      tool: 'addLayer',
      ok: true,
      argumentSummary: 'circle at 10,20',
      deltaCount: 3,
      hasCanvas: false,
      revision: 7,
    });

    expect(result.known).toEqual([
      { key: 'method', label: '方法', value: 'POST' },
      { key: 'path', label: '路径', value: '/paint/canvas' },
      { key: 'statusCode', label: '状态码', value: '200' },
      { key: 'tool', label: '工具', value: 'addLayer' },
      { key: 'ok', label: '结果', value: '是' },
      { key: 'argumentSummary', label: '参数摘要', value: 'circle at 10,20' },
      { key: 'deltaCount', label: '增量数', value: '3' },
      { key: 'hasCanvas', label: '有无画布', value: '无' },
      { key: 'revision', label: '修订号', value: '7' },
    ]);
    expect(result.unknownKeys).toEqual([]);
  });

  it('lists unknown keys for the collapsible raw-JSON fallback', () => {
    const result = describePayloadFields({ method: 'GET', mystery: 42, x: 'y' });

    expect(result.known.map((field) => field.key)).toEqual(['method']);
    expect(result.unknownKeys).toEqual(['mystery', 'x']);
  });

  it('ignores payloads that are not plain objects', () => {
    expect(describePayloadFields('raw string')).toEqual({ known: [], unknownKeys: [] });
    expect(describePayloadFields(null)).toEqual({ known: [], unknownKeys: [] });
    expect(describePayloadFields(42)).toEqual({ known: [], unknownKeys: [] });
  });
});

describe('truncateJson', () => {
  it('keeps short JSON intact', () => {
    expect(truncateJson('{"a":1}')).toEqual({ text: '{"a":1}', truncated: false });
  });

  it('cuts beyond the limit and flags the truncation', () => {
    const result = truncateJson('x'.repeat(2_500), 2_000);

    expect(result.truncated).toBe(true);
    expect(result.text).toHaveLength(2_000);
    expect(result.text).toBe('x'.repeat(2_000));
  });
});

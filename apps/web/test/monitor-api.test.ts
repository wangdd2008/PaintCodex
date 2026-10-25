import { describe, expect, it } from 'vitest';
import { buildLogsQuery } from '../src/features/monitor/monitor-api';

describe('buildLogsQuery', () => {
  it('applies the default limit and offset', () => {
    expect(buildLogsQuery()).toBe('?limit=50&offset=0');
    expect(buildLogsQuery({})).toBe('?limit=50&offset=0');
  });

  it('serializes a single category and level', () => {
    expect(buildLogsQuery({ category: 'http', level: 'error' })).toBe(
      '?category=http&level=error&limit=50&offset=0',
    );
  });

  it('serializes multi-value category and level filters', () => {
    expect(buildLogsQuery({ category: ['http', 'sse'], level: ['warn', 'error'] })).toBe(
      '?category=http,sse&level=warn,error&limit=50&offset=0',
    );
  });

  it('serializes absolute time bounds', () => {
    expect(buildLogsQuery({ since: 1000, until: 2000 })).toBe(
      '?since=1000&until=2000&limit=50&offset=0',
    );
  });

  it('serializes paging and encodes identifier filters', () => {
    expect(
      buildLogsQuery({ traceId: 'trace 1', canvasId: 'canvas/1', limit: 100, offset: 200 }),
    ).toBe('?traceId=trace%201&canvasId=canvas%2F1&limit=100&offset=200');
  });

  it('emits filters in a stable order', () => {
    expect(
      buildLogsQuery({
        category: 'system',
        level: 'debug',
        traceId: 'trace',
        canvasId: 'canvas',
        since: 1,
        until: 2,
        limit: 10,
        offset: 3,
      }),
    ).toBe(
      '?category=system&level=debug&traceId=trace&canvasId=canvas&since=1&until=2&limit=10&offset=3',
    );
  });

  it('skips empty identifier filters and empty value lists', () => {
    expect(buildLogsQuery({ traceId: '', canvasId: '', category: [], level: [] })).toBe(
      '?limit=50&offset=0',
    );
  });
});

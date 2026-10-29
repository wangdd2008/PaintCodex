// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LogDetail } from '../src/features/monitor/log-detail';

afterEach(cleanup);

describe('LogDetail', () => {
  it('renders known payload fields as label/value rows', () => {
    render(
      <LogDetail payload={{ method: 'GET', path: '/health', statusCode: 200 }} />,
    );

    expect(screen.getByText('方法')).toBeTruthy();
    expect(screen.getByText('GET')).toBeTruthy();
    expect(screen.getByText('路径')).toBeTruthy();
    expect(screen.getByText('/health')).toBeTruthy();
    expect(screen.getByText('状态码')).toBeTruthy();
    expect(screen.getByText('200')).toBeTruthy();
  });

  it('renders boolean flags as 是/否', () => {
    render(<LogDetail payload={{ tool: 'addLayer', ok: false, hasCanvas: true }} />);

    expect(screen.getByText('否')).toBeTruthy();
    expect(screen.getByText('有')).toBeTruthy();
  });

  it('falls unknown keys back to collapsible raw JSON', () => {
    render(<LogDetail payload={{ method: 'GET', mystery: 42 }} />);

    expect(screen.getByText('原始 JSON')).toBeTruthy();
    expect(screen.getByText(/mystery/)).toBeTruthy();
  });

  it('marks raw JSON beyond 200 characters... (2000 in the UI) as truncated', () => {
    render(<LogDetail payload={{ padding: 'y'.repeat(2_500) }} />);

    expect(screen.getByText(/已截断/)).toBeTruthy();
  });

  it('says nothing to show when the payload is missing', () => {
    render(<LogDetail payload={null} />);

    expect(screen.getByText('无 payload 明细')).toBeTruthy();
  });
});

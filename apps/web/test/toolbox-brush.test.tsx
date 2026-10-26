// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Toolbox } from '../src/features/toolbox/Toolbox';
import {
  DEFAULT_BRUSH_COLOR,
  DEFAULT_BRUSH_WIDTH,
  useToolStore,
} from '../src/services/tool-store';

beforeEach(() => {
  useToolStore.setState({
    tool: 'brush',
    brushColor: DEFAULT_BRUSH_COLOR,
    brushWidth: DEFAULT_BRUSH_WIDTH,
  });
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe('画笔颜色', () => {
  it('offers the six presets plus a custom color input', () => {
    render(<Toolbox />);

    const palette = screen.getByRole('group', { name: '画笔颜色' });
    expect(palette).toBeTruthy();

    for (const name of ['黑色', '深灰色', '红色', '橙色', '蓝色', '绿色']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }

    expect(screen.getByLabelText('自定义画笔颜色')).toBeTruthy();
  });

  it('starts on the default black and marks it selected', () => {
    render(<Toolbox />);

    expect(useToolStore.getState().brushColor).toBe('#111111');
    expect(
      screen.getByRole('button', { name: '黑色' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      screen.getByRole('button', { name: '红色' }).getAttribute('aria-pressed'),
    ).toBe('false');
  });

  it('switches the session color when a preset is clicked', () => {
    render(<Toolbox />);

    fireEvent.click(screen.getByRole('button', { name: '红色' }));

    expect(useToolStore.getState().brushColor).toBe('#dc2626');
    expect(
      screen.getByRole('button', { name: '红色' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      screen.getByRole('button', { name: '黑色' }).getAttribute('aria-pressed'),
    ).toBe('false');
    // Session-only: nothing is written to storage.
    expect(window.localStorage.length).toBe(0);
  });

  it('accepts a custom color from the color input', () => {
    render(<Toolbox />);
    const input = screen.getByLabelText('自定义画笔颜色') as HTMLInputElement;

    fireEvent.change(input, { target: { value: '#7c3aed' } });

    expect(useToolStore.getState().brushColor).toBe('#7c3aed');
    expect(input.value).toBe('#7c3aed');
    expect(
      screen.getByRole('button', { name: '黑色' }).getAttribute('aria-pressed'),
    ).toBe('false');
  });
});

describe('画笔粗细', () => {
  it('offers four widths with a preview', () => {
    render(<Toolbox />);

    const widths = screen.getByRole('group', { name: '画笔粗细' });
    expect(widths).toBeTruthy();

    for (const width of [2, 4, 8, 16]) {
      expect(screen.getByRole('button', { name: `笔宽 ${width}` })).toBeTruthy();
    }
  });

  it('defaults to width 6 with the default width visibly and accessibly selected', () => {
    render(<Toolbox />);

    expect(useToolStore.getState().brushWidth).toBe(6);
    for (const width of [2, 4, 8, 16]) {
      expect(
        screen
          .getByRole('button', { name: `笔宽 ${width}` })
          .getAttribute('aria-pressed'),
      ).toBe('false');
    }

    const defaultWidth = screen.getByRole('button', { name: '笔宽 6（默认）' });
    expect(defaultWidth.getAttribute('aria-pressed')).toBe('true');
    expect(defaultWidth.textContent).toContain('6');
  });

  it('switches the session width when a preset is clicked', () => {
    render(<Toolbox />);

    fireEvent.click(screen.getByRole('button', { name: '笔宽 8' }));

    expect(useToolStore.getState().brushWidth).toBe(8);
    expect(
      screen.getByRole('button', { name: '笔宽 8' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(window.localStorage.length).toBe(0);
  });

  it('after clicking 8, exactly 8 is selected and the default item is gone', () => {
    render(<Toolbox />);

    fireEvent.click(screen.getByRole('button', { name: '笔宽 8' }));

    const widthsGroup = screen.getByRole('group', { name: '画笔粗细' });
    const pressed = Array.from(
      widthsGroup.querySelectorAll('button[aria-pressed="true"]'),
    );

    expect(pressed).toHaveLength(1);
    expect(pressed[0]?.getAttribute('aria-label')).toBe('笔宽 8');
    expect(screen.queryByRole('button', { name: '笔宽 6（默认）' })).toBeNull();
  });
});

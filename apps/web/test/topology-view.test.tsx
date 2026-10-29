// @vitest-environment jsdom
import type { TopologySnapshot } from '@paintcodex/protocol';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TopologyView } from '../src/features/monitor/TopologyView';

afterEach(cleanup);

function makeSnapshot(overrides: Partial<TopologySnapshot> = {}): TopologySnapshot {
  return {
    windowMs: 300_000,
    nodes: [
      { id: 'browser', count: 3, errorCount: 0 },
      { id: 'daemon', count: 4, errorCount: 1 },
      { id: 'codex', count: 1, errorCount: 0 },
      { id: 'model', count: 0, errorCount: 0 },
      { id: 'sqlite', count: 0, errorCount: 0 },
    ],
    edges: [
      { source: 'browser', target: 'daemon', count: 2, errorCount: 0, avgDurationMs: 100 },
      { source: 'daemon', target: 'browser', count: 1, errorCount: 1, avgDurationMs: 200 },
    ],
    ...overrides,
  };
}

describe('TopologyView', () => {
  it('渲染五个节点文字与四条通道，图本身有可读 aria-label', () => {
    render(
      <TopologyView
        snapshot={makeSnapshot()}
        chip={null}
        onToggleNode={vi.fn()}
        onToggleChannel={vi.fn()}
      />,
    );

    expect(screen.getByRole('group', { name: /组件通信拓扑/ })).toBeTruthy();
    // 节点文字不是纯装饰。
    expect(screen.getByText('浏览器')).toBeTruthy();
    expect(screen.getByText('Daemon')).toBeTruthy();
    expect(screen.getByText('Codex')).toBeTruthy();
    expect(screen.getByText('模型')).toBeTruthy();
    expect(screen.getByText('SQLite')).toBeTruthy();
    // 四条通道都可聚焦（role=button）。
    expect(screen.getAllByRole('button')).toHaveLength(9); // 5 节点 + 4 通道
  });

  it('model 节点显示「—」而不是 0，其余节点显示叠加数字', () => {
    render(
      <TopologyView
        snapshot={makeSnapshot()}
        chip={null}
        onToggleNode={vi.fn()}
        onToggleChannel={vi.fn()}
      />,
    );

    // model 恒显示「—」；节点数字通过 aria-label 断言（与通道中点文字区分开）。
    expect(screen.getByText('— 条')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /浏览器：3 条消息/ }),
    ).toBeTruthy();
  });

  it('错误数 > 0 时有非颜色的视觉区分（错误角标与外圈）', () => {
    render(
      <TopologyView
        snapshot={makeSnapshot()}
        chip={null}
        onToggleNode={vi.fn()}
        onToggleChannel={vi.fn()}
      />,
    );

    // 错误角标文字「!」与节点计数里的「错」字同时出现。
    expect(screen.getAllByText('!')).toHaveLength(1);
    expect(screen.getByText('4 条 · 1 错')).toBeTruthy();
  });

  it('点击节点回调组件 id；键盘 Enter 同样触发', () => {
    const onToggleNode = vi.fn();

    render(
      <TopologyView
        snapshot={makeSnapshot()}
        chip={null}
        onToggleNode={onToggleNode}
        onToggleChannel={vi.fn()}
      />,
    );

    const daemonNode = screen.getByRole('button', { name: /Daemon：/ });
    fireEvent.click(daemonNode);
    expect(onToggleNode).toHaveBeenLastCalledWith('daemon');

    // 键盘可遍历节点：Enter 触发与点击相同的回调。
    fireEvent.keyDown(daemonNode, { key: 'Enter' });
    expect(onToggleNode).toHaveBeenCalledTimes(2);
  });

  it('点击通道回调通道 id；通道 aria-label 说明可过滤', () => {
    const onToggleChannel = vi.fn();

    render(
      <TopologyView
        snapshot={makeSnapshot()}
        chip={null}
        onToggleNode={vi.fn()}
        onToggleChannel={onToggleChannel}
      />,
    );

    const edge = screen.getByRole('button', { name: /过滤.*浏览器.*Daemon/ });
    fireEvent.click(edge);
    expect(onToggleChannel).toHaveBeenCalledWith('browser-daemon');
  });

  it('选中的节点 aria-pressed 为 true；无快照时图不变形（节点仍在）', () => {
    render(
      <TopologyView
        snapshot={null}
        chip={{ kind: 'component', component: 'daemon' }}
        onToggleNode={vi.fn()}
        onToggleChannel={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /Daemon：/ }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    // 空快照：五个节点照常渲染；节点与通道的计数都是 0（4 节点 + 4 通道中点）。
    expect(screen.getByText('浏览器')).toBeTruthy();
    expect(screen.getAllByText('0 条')).toHaveLength(8);
  });
});

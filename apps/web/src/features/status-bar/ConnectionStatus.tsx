export type ConnectionState = 'connecting' | 'live' | 'reconnecting';

/** 三态文案，和监控页「实时中／重新连接中…」保持同一套说法。 */
export function connectionStatusText(state: ConnectionState): string {
  switch (state) {
    case 'live':
      return '实时中';
    case 'reconnecting':
      return '重新连接中…';
    default:
      return '连接中…';
  }
}

/**
 * 状态栏连接槽位：小圆点 + 短文案。
 *
 * - 一个 `role="status"` 节点承载整条状态：每次状态变化只播报一次，
 *   圆点本身 `aria-hidden`，不会被逐次朗读；
 * - 断线是琥珀色（同监控页），不是红色错误横幅——SSE 断线不是操作失败；
 * - 不提供手动重连：EventSource 自己重连，恢复后由 `onOpen` 触发一次刷新。
 */
export function ConnectionStatus({ state }: { state: ConnectionState }) {
  return (
    <span
      className={`status-bar__connection status-bar__connection--${state}`}
      role="status"
      aria-atomic="true"
    >
      <span className="status-bar__connection-dot" aria-hidden="true" />
      {connectionStatusText(state)}
    </span>
  );
}

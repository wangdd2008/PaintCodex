import type { LogComponent } from '@paintcodex/protocol';

/**
 * 一条消息的方向：发出方 → 接收方。只有「消息型」记录才有方向；
 * 内部事件（system 启动、进程错误等）不在这里，落库时保持 NULL，
 * 语义是「内部」而不是「未知」——它本来就不过任何网络通道。
 */
export interface LogDirection {
  source: LogComponent;
  target: LogComponent;
}

/**
 * 方向映射表（monitor-readability spec §1 以此为准）。
 *
 * 这是「谁发给谁」的唯一事实来源：埋点按这里登记方向，绝不按 category
 * 统一猜——`codex-runtime` 分类里请求与响应并存，单凭 category 会猜错。
 * HTTP 的开始与结束共用 message `http_request`，因此拆成两个具名条目，
 * 由埋点按生命周期阶段选用。`model` 没有任何直接日志，只存在于拓扑。
 */
export const LOG_DIRECTIONS = {
  /** HTTP 请求开始：浏览器 → daemon。 */
  httpStart: { source: 'browser', target: 'daemon' },
  /** HTTP 响应结束：daemon → 浏览器。 */
  httpEnd: { source: 'daemon', target: 'browser' },
  /** SSE 订阅：浏览器 → daemon。 */
  sseSubscribe: { source: 'browser', target: 'daemon' },
  /** SSE 推送：daemon → 浏览器。 */
  ssePublish: { source: 'daemon', target: 'browser' },
  /** SSE 断开：浏览器 → daemon。 */
  sseDisconnect: { source: 'browser', target: 'daemon' },
  /** turn 发起：daemon → codex。 */
  turnStart: { source: 'daemon', target: 'codex' },
  /** turn 完成：codex → daemon。 */
  turnComplete: { source: 'codex', target: 'daemon' },
  /** thread 建立：daemon → codex。 */
  threadStart: { source: 'daemon', target: 'codex' },
  /** thread 恢复：daemon → codex。 */
  threadResume: { source: 'daemon', target: 'codex' },
  /** 工具调用（canvas-tool）：codex → daemon。 */
  toolCall: { source: 'codex', target: 'daemon' },
  /** 画布落库：以下全部是 daemon → sqlite。 */
  layerCreate: { source: 'daemon', target: 'sqlite' },
  layerUpdate: { source: 'daemon', target: 'sqlite' },
  layerDelete: { source: 'daemon', target: 'sqlite' },
  undo: { source: 'daemon', target: 'sqlite' },
  redo: { source: 'daemon', target: 'sqlite' },
  canvasCreate: { source: 'daemon', target: 'sqlite' },
  canvasRename: { source: 'daemon', target: 'sqlite' },
  /**
   * 画布落库的统一方向：service 的 canvas-action 埋点只认这一条，
   * create/update/delete/undo/redo/rename 都走 daemon → sqlite。
   */
  canvasPersist: { source: 'daemon', target: 'sqlite' },
} as const satisfies Readonly<Record<string, LogDirection>>;

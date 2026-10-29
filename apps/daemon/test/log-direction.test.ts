import { describe, expect, it } from 'vitest';
import { LOG_DIRECTIONS } from '../src/observability/log-direction.js';

/**
 * 方向映射表是「谁发给谁」的唯一事实来源（monitor-readability spec §1）。
 * 每条映射一行断言；新增埋点时必须在这里登记方向，避免按 category 猜。
 */
describe('日志方向映射表', () => {
  it('HTTP 请求：浏览器发起 → daemon，响应结束 → 浏览器', () => {
    expect(LOG_DIRECTIONS.httpStart).toEqual({
      source: 'browser',
      target: 'daemon',
    });
    expect(LOG_DIRECTIONS.httpEnd).toEqual({
      source: 'daemon',
      target: 'browser',
    });
  });

  it('SSE：订阅/断开浏览器→daemon，推送 daemon→浏览器', () => {
    expect(LOG_DIRECTIONS.sseSubscribe).toEqual({
      source: 'browser',
      target: 'daemon',
    });
    expect(LOG_DIRECTIONS.ssePublish).toEqual({
      source: 'daemon',
      target: 'browser',
    });
    expect(LOG_DIRECTIONS.sseDisconnect).toEqual({
      source: 'browser',
      target: 'daemon',
    });
  });

  it('turn/thread：发起与建立恢复 daemon→codex，完成 codex→daemon', () => {
    expect(LOG_DIRECTIONS.turnStart).toEqual({
      source: 'daemon',
      target: 'codex',
    });
    expect(LOG_DIRECTIONS.turnComplete).toEqual({
      source: 'codex',
      target: 'daemon',
    });
    expect(LOG_DIRECTIONS.threadStart).toEqual({
      source: 'daemon',
      target: 'codex',
    });
    expect(LOG_DIRECTIONS.threadResume).toEqual({
      source: 'daemon',
      target: 'codex',
    });
  });

  it('工具调用（canvas-tool）：codex→daemon', () => {
    expect(LOG_DIRECTIONS.toolCall).toEqual({
      source: 'codex',
      target: 'daemon',
    });
  });

  it('画布落库（canvasPersist）：daemon→sqlite', () => {
    // 埋点只登记统一方向 canvasPersist（create/update/delete/undo/redo/rename
    // 共用）；曾为每种动作预登记的 7 条死键已删除，这里只断言实际在用的条目。
    expect(LOG_DIRECTIONS.canvasPersist).toEqual({
      source: 'daemon',
      target: 'sqlite',
    });
  });

  it('方向两端都来自组件词表', () => {
    const components = ['browser', 'daemon', 'codex', 'model', 'sqlite'];

    for (const direction of Object.values(LOG_DIRECTIONS)) {
      expect(components).toContain(direction.source);
      expect(components).toContain(direction.target);
    }
  });
});

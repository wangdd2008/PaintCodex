// @vitest-environment jsdom
// 会话记录跨刷新保留：transcripts 落到 sessionStorage，刷新（模块重新加载）后读回。
// 与 UX-24 的差别是「会话」从「一次页面生命周期」放宽到「一个标签页生命周期」——
// 关掉标签页仍然清空，服务端依旧不存对话。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../src/features/ai-chat/chat-message';

const KEY = 'paintcodex.chat.transcripts.v1';

function message(id: number, content: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id, role: 'user', content, ...extra };
}

async function freshStore() {
  vi.resetModules();
  return import('../src/features/ai-chat/chat-store');
}

describe('会话记录跨刷新保留（sessionStorage）', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  afterEach(() => {
    window.sessionStorage.clear();
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('写入某张画布的桶时同步落到 sessionStorage', async () => {
    const { useChatStore } = await freshStore();

    useChatStore.getState().updateTranscript('c1', () => [message(1, '你好')]);

    const raw = window.sessionStorage.getItem(KEY);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!)).toEqual({ c1: [message(1, '你好')] });
  });

  it('刷新（模块重新加载）后读回同一张画布的记录', async () => {
    const first = await freshStore();
    first.useChatStore
      .getState()
      .updateTranscript('c1', () => [message(1, '你好'), message(2, '帮我画个圆')]);

    const second = await freshStore();

    expect(second.useChatStore.getState().transcripts.c1?.map((m) => m.content)).toEqual([
      '你好',
      '帮我画个圆',
    ]);
  });

  it('不同画布的桶各归各的', async () => {
    const first = await freshStore();
    first.useChatStore.getState().updateTranscript('c1', () => [message(1, 'A')]);
    first.useChatStore.getState().updateTranscript('c2', () => [message(2, 'B')]);

    const second = await freshStore();

    expect(second.useChatStore.getState().transcripts).toEqual({
      c1: [message(1, 'A')],
      c2: [message(2, 'B')],
    });
  });

  it('存储内容损坏时退回空记录，不抛错', async () => {
    window.sessionStorage.setItem(KEY, '{{{ 不是 JSON');

    const { useChatStore } = await freshStore();

    expect(useChatStore.getState().transcripts).toEqual({});
  });

  it('存储不可用（配额/禁用）时内存记录仍然可写', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    const { useChatStore } = await freshStore();

    expect(() =>
      useChatStore.getState().updateTranscript('c1', () => [message(1, 'x')]),
    ).not.toThrow();
    expect(useChatStore.getState().transcripts.c1).toHaveLength(1);
  });

  it('刷新时把在飞的残留状态收敛掉：生成中记作未完成，挂起确认与运行中工具不再转圈', async () => {
    window.sessionStorage.setItem(
      KEY,
      JSON.stringify({
        c1: [
          message(1, '画一个圆', {
            generating: true,
            tools: [{ id: 't1', name: 'canvas_create_layer', status: 'running' }],
            confirmations: [{ id: 'q1', title: '删除图层', detail: '确定删除？', status: 'pending' }],
          }),
        ],
      }),
    );

    const { useChatStore } = await freshStore();
    const [restored] = useChatStore.getState().transcripts.c1 ?? [];

    expect(restored?.generating).toBe(false);
    expect(restored?.incomplete).toBe(true);
    expect(restored?.tools?.[0]?.status).toBe('failed');
    expect(restored?.confirmations?.[0]?.status).toBe('expired');
  });

  it('删除画布时丢掉它的桶，不留孤儿记录', async () => {
    const { useChatStore } = await freshStore();
    useChatStore.getState().updateTranscript('c1', () => [message(1, 'A')]);
    useChatStore.getState().updateTranscript('c2', () => [message(2, 'B')]);

    useChatStore.getState().dropTranscript('c1');

    expect(useChatStore.getState().transcripts).toEqual({ c2: [message(2, 'B')] });
    const raw = window.sessionStorage.getItem(KEY)!;
    expect(JSON.parse(raw)).toEqual({ c2: [message(2, 'B')] });
  });
});

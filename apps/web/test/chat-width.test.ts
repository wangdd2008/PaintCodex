// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  CHAT_WIDTH_DEFAULT,
  CHAT_WIDTH_MAX,
  CHAT_WIDTH_MIN,
  CHAT_WIDTH_STORAGE_KEY,
  clampChatWidth,
  nextChatWidth,
  readChatWidth,
  writeChatWidth,
} from '../src/services/chat-width';

afterEach(() => {
  window.localStorage.clear();
});

describe('对话面板宽度常量', () => {
  it('默认 380px，夹在 320–640px 之间', () => {
    expect(CHAT_WIDTH_DEFAULT).toBe(380);
    expect(CHAT_WIDTH_MIN).toBe(320);
    expect(CHAT_WIDTH_MAX).toBe(640);
    expect(CHAT_WIDTH_MIN).toBeLessThanOrEqual(CHAT_WIDTH_DEFAULT);
    expect(CHAT_WIDTH_DEFAULT).toBeLessThanOrEqual(CHAT_WIDTH_MAX);
    expect(CHAT_WIDTH_STORAGE_KEY).toBe('paintcodex.chatWidth');
  });
});

describe('clampChatWidth', () => {
  it('把越界宽度夹回 [320, 640]', () => {
    expect(clampChatWidth(0)).toBe(CHAT_WIDTH_MIN);
    expect(clampChatWidth(100)).toBe(CHAT_WIDTH_MIN);
    expect(clampChatWidth(319)).toBe(CHAT_WIDTH_MIN);
    expect(clampChatWidth(320)).toBe(320);
    expect(clampChatWidth(380)).toBe(380);
    expect(clampChatWidth(640)).toBe(640);
    expect(clampChatWidth(641)).toBe(CHAT_WIDTH_MAX);
    expect(clampChatWidth(10_000)).toBe(CHAT_WIDTH_MAX);
  });

  it('非数字输入回落到默认值', () => {
    expect(clampChatWidth(Number.NaN)).toBe(CHAT_WIDTH_DEFAULT);
    expect(clampChatWidth(Number.POSITIVE_INFINITY)).toBe(CHAT_WIDTH_MAX);
  });
});

describe('readChatWidth / writeChatWidth', () => {
  it('没有记录时返回默认 380', () => {
    expect(readChatWidth()).toBe(CHAT_WIDTH_DEFAULT);
  });

  it('写入后能读回，且被 clamp', () => {
    writeChatWidth(450);
    expect(window.localStorage.getItem(CHAT_WIDTH_STORAGE_KEY)).toBe('450');
    expect(readChatWidth()).toBe(450);

    // 越界写入先夹再存：拖到 999 落回 640。
    writeChatWidth(999);
    expect(readChatWidth()).toBe(CHAT_WIDTH_MAX);
    expect(window.localStorage.getItem(CHAT_WIDTH_STORAGE_KEY)).toBe('640');
  });

  it('localStorage 里是脏数据时回落到默认', () => {
    window.localStorage.setItem(CHAT_WIDTH_STORAGE_KEY, 'not-a-number');
    expect(readChatWidth()).toBe(CHAT_WIDTH_DEFAULT);

    window.localStorage.setItem(CHAT_WIDTH_STORAGE_KEY, '');
    expect(readChatWidth()).toBe(CHAT_WIDTH_DEFAULT);
  });
});

describe('nextChatWidth（键盘调节）', () => {
  it('→ +16px，← −16px', () => {
    expect(nextChatWidth(380, 'ArrowRight')).toBe(396);
    expect(nextChatWidth(380, 'ArrowLeft')).toBe(364);
  });

  it('到 320/640 边界后不再越界', () => {
    // 320 再 ← 仍是 320。
    expect(nextChatWidth(320, 'ArrowLeft')).toBe(320);
    expect(nextChatWidth(330, 'ArrowLeft')).toBe(320);
    // 640 再 → 仍是 640。
    expect(nextChatWidth(640, 'ArrowRight')).toBe(640);
    expect(nextChatWidth(630, 'ArrowRight')).toBe(640);
  });

  it('Home 到最小，End 到最大', () => {
    expect(nextChatWidth(380, 'Home')).toBe(CHAT_WIDTH_MIN);
    expect(nextChatWidth(380, 'End')).toBe(CHAT_WIDTH_MAX);
  });

  it('其它键返回原值（不消费）', () => {
    expect(nextChatWidth(380, 'Enter')).toBe(380);
    expect(nextChatWidth(380, ' ')).toBe(380);
    expect(nextChatWidth(380, 'ArrowUp')).toBe(380);
  });
});

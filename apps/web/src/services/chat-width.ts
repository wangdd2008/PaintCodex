/**
 * 对话面板宽度（票 ②01）。
 *
 * 宽度是一个跨会话记住的偏好：范围 320–640px，默认 380px，
 * 持久化到 localStorage['paintcodex.chatWidth']。拖动、键盘、双击复位
 * 都先经过这里，组件只负责接线，不自己算 clamp。
 */

export const CHAT_WIDTH_MIN = 320;
export const CHAT_WIDTH_MAX = 640;
export const CHAT_WIDTH_DEFAULT = 380;
export const CHAT_WIDTH_STORAGE_KEY = 'paintcodex.chatWidth';

/** 键盘方向键一次步进 16px（spec §1）。 */
const KEYBOARD_STEP_PX = 16;

/** 把任意数值夹回合法范围；非数字回落默认值，+∞ 落到上界。 */
export function clampChatWidth(width: number): number {
  if (Number.isNaN(width)) {
    return CHAT_WIDTH_DEFAULT;
  }

  if (!Number.isFinite(width)) {
    return width > 0 ? CHAT_WIDTH_MAX : CHAT_WIDTH_DEFAULT;
  }

  return Math.min(CHAT_WIDTH_MAX, Math.max(CHAT_WIDTH_MIN, width));
}

/** 读回记住的宽度；没有记录或脏数据时用默认值。 */
export function readChatWidth(): number {
  let stored: string | null = null;

  try {
    stored = window.localStorage.getItem(CHAT_WIDTH_STORAGE_KEY);
  } catch {
    // 隐私模式等读不出来时按默认走，不影响布局。
    return CHAT_WIDTH_DEFAULT;
  }

  if (stored === null) {
    return CHAT_WIDTH_DEFAULT;
  }

  const parsed = Number.parseFloat(stored);

  if (Number.isNaN(parsed)) {
    return CHAT_WIDTH_DEFAULT;
  }

  return clampChatWidth(parsed);
}

/** 写入记住的宽度；先夹后存。 */
export function writeChatWidth(width: number): void {
  const clamped = clampChatWidth(width);

  try {
    window.localStorage.setItem(CHAT_WIDTH_STORAGE_KEY, String(clamped));
  } catch {
    // 写不进去（配额/隐私模式）也不影响当次会话。
  }
}

/**
 * 键盘调节后的宽度。
 * - ArrowRight / ArrowLeft：±16px，夹在边界内。
 * - Home：跳到最小；End：跳到最大。
 * - 其它键：返回原值，由调用方决定是否 preventDefault。
 */
export function nextChatWidth(current: number, key: string): number {
  switch (key) {
    case 'ArrowRight':
      return clampChatWidth(current + KEYBOARD_STEP_PX);
    case 'ArrowLeft':
      return clampChatWidth(current - KEYBOARD_STEP_PX);
    case 'Home':
      return CHAT_WIDTH_MIN;
    case 'End':
      return CHAT_WIDTH_MAX;
    default:
      return current;
  }
}

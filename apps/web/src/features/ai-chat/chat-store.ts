import { create } from 'zustand';
import type { ChatMessage } from './chat-message';

/**
 * 会话记录（Chat Transcript）按画布分区：`transcripts` 的键是 canvasId，
 * 每张画布一张桶。归属由键表达，消息本身不带 canvasId（GLOSSARY「会话记录」）。
 *
 * 持久化边界：写 sessionStorage，所以**同一标签页内刷新不丢**，标签页关闭即结束
 * （服务端仍然不存对话）。collect 时会把在飞的残留状态收敛掉：流式回复已经
 * 随页面一起消失，`generating` 不能继续转圈。
 */
export const CHAT_TRANSCRIPTS_STORAGE_KEY = 'paintcodex.chat.transcripts.v1';

export type ChatTranscripts = Record<string, ChatMessage[]>;

interface ChatState {
  /** canvasId → 该画布的消息序列。从未对话过的键直接缺省。 */
  transcripts: ChatTranscripts;
  /** 对某张画布的桶做一次不可变更新；桶不存在时按空序列起步。 */
  updateTranscript: (
    canvasId: string,
    updater: (previous: ChatMessage[]) => ChatMessage[],
  ) => void;
  /** 画布被删除时丢掉它的桶，避免留下再也点不到的记录。 */
  dropTranscript: (canvasId: string) => void;
}

function isMessages(value: unknown): value is ChatMessage[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as ChatMessage).id === 'number' &&
        ((item as ChatMessage).role === 'user' ||
          (item as ChatMessage).role === 'assistant') &&
        typeof (item as ChatMessage).content === 'string',
    )
  );
}

function isTranscripts(value: unknown): value is ChatTranscripts {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every(isMessages)
  );
}

/**
 * 刷新等于「上一轮的流已经断了」：生成中的回复记作未完成，运行中的工具判失败，
 * 挂起的确认条过期——它们都再也等不到那一帧了。
 */
function settleInterrupted(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) => {
    let next = message;

    if (next.generating) {
      next = { ...next, generating: false, incomplete: true };
    }

    if (next.tools?.some((tool) => tool.status === 'running')) {
      next = {
        ...next,
        tools: next.tools.map((tool) =>
          tool.status === 'running' ? { ...tool, status: 'failed' } : tool,
        ),
      };
    }

    if (
      next.confirmations?.some(
        (confirmation) =>
          confirmation.status === 'pending' || confirmation.status === 'submitting',
      )
    ) {
      next = {
        ...next,
        confirmations: next.confirmations.map((confirmation) =>
          confirmation.status === 'pending' || confirmation.status === 'submitting'
            ? { ...confirmation, status: 'expired' }
            : confirmation,
        ),
      };
    }

    return next;
  });
}

function readTranscripts(): ChatTranscripts {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const raw = window.sessionStorage.getItem(CHAT_TRANSCRIPTS_STORAGE_KEY);

    if (!raw) {
      return {};
    }

    const parsed: unknown = JSON.parse(raw);

    if (!isTranscripts(parsed)) {
      return {};
    }

    const restored: ChatTranscripts = {};

    for (const [canvasId, messages] of Object.entries(parsed)) {
      restored[canvasId] = settleInterrupted(messages);
    }

    return restored;
  } catch {
    // 损坏或不可用的存储不该让整个画布页打不开：退回空记录即可。
    return {};
  }
}

function writeTranscripts(transcripts: ChatTranscripts): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.sessionStorage.setItem(
      CHAT_TRANSCRIPTS_STORAGE_KEY,
      JSON.stringify(transcripts),
    );
  } catch {
    // 配额写满或隐私模式禁用存储：内存里的会话照常继续。
  }
}

export const useChatStore = create<ChatState>((set, get) => ({
  transcripts: readTranscripts(),
  updateTranscript: (canvasId, updater) => {
    const previous = get().transcripts[canvasId] ?? [];
    const transcripts: ChatTranscripts = {
      ...get().transcripts,
      [canvasId]: updater(previous),
    };

    set({ transcripts });
    writeTranscripts(transcripts);
  },
  dropTranscript: (canvasId) => {
    if (!(canvasId in get().transcripts)) {
      return;
    }

    const { [canvasId]: _dropped, ...rest } = get().transcripts;

    set({ transcripts: rest });
    writeTranscripts(rest);
  },
}));

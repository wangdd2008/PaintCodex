import { create } from 'zustand';
import type { ChatMessage } from './chat-message';

/**
 * 会话记录按画布分区（spec §6）：`transcripts` 的键是 canvasId，
 * 每张画布一张桶。它是会话态——不写 localStorage / sessionStorage，
 * 刷新即空，也不设条数上限。服务端不存对话（沿用 UX-24）。
 */
interface ChatState {
  /** canvasId → 该画布的消息序列。从未对话过的键直接缺省。 */
  transcripts: Record<string, ChatMessage[]>;
  /** 对某张画布的桶做一次不可变更新；桶不存在时按空序列起步。 */
  updateTranscript: (
    canvasId: string,
    updater: (previous: ChatMessage[]) => ChatMessage[],
  ) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  transcripts: {},
  updateTranscript: (canvasId, updater) =>
    set((state) => ({
      transcripts: {
        ...state.transcripts,
        [canvasId]: updater(state.transcripts[canvasId] ?? []),
      },
    })),
}));

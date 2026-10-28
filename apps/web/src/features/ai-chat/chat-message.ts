/**
 * 会话记录（Chat Transcript）的消息形状。它不携带 canvasId——
 * 归属由 useChatStore 里桶的键表达（GLOSSARY「会话记录」）。
 */

/** 这次回复落地的 AI 图层，以及撤销守卫要比较的 revision。 */
export interface ChatLayerConfirmation {
  id: string;
  name: string;
  canvasId: string | null;
  /** AI 图层生成后产生的 revision；只有当前 revision 与它相等时才允许撤销。 */
  expectedRevision: number;
  /** 用户已撤销这一步，避免撤销入口再次出现。 */
  undone?: boolean;
}

export interface ChatToolLine {
  id: string;
  name: string;
  status: 'running' | 'ok' | 'failed';
  /** Failure code from the daemon; localized before it reaches the screen. */
  code?: string;
}

/** 挂起中的危险操作：确认条在答复前一直是气泡的一部分。 */
export interface ChatConfirmation {
  id: string;
  title: string;
  detail: string;
  /** daemon 给这条确认的 CTA 文案；缺省沿用删除文案。 */
  approveLabel?: string;
  status: 'pending' | 'submitting' | 'approved' | 'declined' | 'expired';
  /** 提交失败的原因；确认条保持可重试。 */
  error?: string;
}

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  /** Set on the pending reply when the user cancels it. */
  cancelled?: boolean;
  /** 首个 delta 已到达：等待文案切换为「正在生成…」。 */
  generating?: boolean;
  /** done 时结算的固定用时；运行结束后继续保留。 */
  durationSeconds?: number;
  /** 从 `layerCreated` 帧消费到的落地确认。 */
  layer?: ChatLayerConfirmation;
  /** 这一轮里的写类工具调用，渲染为气泡内的动作行。 */
  tools?: ChatToolLine[];
  /** 这一轮里挂起的确认条，按到达顺序排列。 */
  confirmations?: ChatConfirmation[];
  /** 这一轮失败了：气泡必须留下「未完成」，不能是空白。 */
  incomplete?: boolean;
  /** 非致命提示（例如会话已重置）：气泡内一行说明，回复继续。 */
  notice?: string;
}

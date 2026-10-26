import { isNetworkFailure } from '../../services/network-error';

/** 一条面向用户的失败说明；界面只渲染这里的中文，不渲染原始报错。 */
export interface ChatFailure {
  message: string;
  /** 这一轮请求可以原样重发；取消不是失败，不经过这里。 */
  retryable: boolean;
}

export interface ChatFailureInput {
  /** daemon 在 SSE 帧或 HTTP 错误体里给出的错误码。 */
  code?: string | null;
  /** HTTP 状态码；网络层失败时为 null。 */
  status?: number | null;
  /** 原始报错文本，只用于分类，绝不直接显示。 */
  message?: string | null;
  /** fetch 本身抛错（连接被拒、断网），没有 HTTP 状态。 */
  networkError?: boolean;
}

const NETWORK_FAILURE =
  '无法连接到本地服务，请确认服务已启动。';
const TIMEOUT_FAILURE = '请求超时（等待 120 秒）。';
const CANVAS_REQUIRED = '请先新建一张画布，再让 AI 作画。';
const SERVER_FAILURE = 'AI 服务暂时不可用（服务器错误）。';
const RATE_LIMITED = 'AI 请求过于频繁，稍后再试。';
const REQUEST_REJECTED = 'AI 请求未被接受。';
const INVALID_ACTION = 'AI 返回了无效的画布操作。';
const APPLY_FAILED = 'AI 生成的图层未能应用到画布。';
const GENERIC_FAILURE = 'AI 回复失败。';

const TIMEOUT_PATTERN = /timed?\s*out|timeout|超时/i;

/**
 * 把底层报错折成一句可执行的中文。顺序有意义：网络层失败没有状态码，
 * 504 比其它 5xx 更接近「超时」，`canvas_required` 与超时文案相互独立。
 */
export function describeChatFailure(input: ChatFailureInput = {}): ChatFailure {
  const code = input.code ?? null;
  const status = input.status ?? null;
  const text = input.message ?? '';

  if (input.networkError === true || isNetworkFailure(text)) {
    return { message: NETWORK_FAILURE, retryable: true };
  }

  if (status === 504 || TIMEOUT_PATTERN.test(text)) {
    return { message: TIMEOUT_FAILURE, retryable: true };
  }

  if (code === 'canvas_required') {
    return { message: CANVAS_REQUIRED, retryable: true };
  }

  if (code === 'ai_canvas_action_invalid') {
    return { message: INVALID_ACTION, retryable: true };
  }

  if (code === 'ai_canvas_action_failed') {
    return { message: APPLY_FAILED, retryable: true };
  }

  if (status !== null && status >= 500) {
    return { message: SERVER_FAILURE, retryable: true };
  }

  if (status === 429) {
    return { message: RATE_LIMITED, retryable: true };
  }

  if (status !== null && status >= 400) {
    return { message: REQUEST_REJECTED, retryable: true };
  }

  // 兜底也必须是中文：daemon 的原始 message 可能来自 CLI，不能直接上屏。
  return { message: GENERIC_FAILURE, retryable: true };
}

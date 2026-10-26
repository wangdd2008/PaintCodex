/**
 * 网络层不可达的统一判定。fetch 在连接被拒、断网或 DNS 失败时只抛
 * TypeError，各运行时的 message 措辞不同（浏览器多为 "Failed to fetch"，
 * Node 为 "fetch failed"），这里集中一处匹配，避免各调用点各写一份正则。
 */
const NETWORK_FAILURE_PATTERN =
  /failed to fetch|networkerror|load failed|network request failed|fetch failed|econnrefused|econnreset|enotfound/i;

/** 画布侧统一的网络失败中文说明；AI 对话有自己的措辞，不共用这一句。 */
export const NETWORK_FAILURE_MESSAGE =
  '无法连接本地服务，请确认服务已启动后重试。';

/**
 * 兼容 Error 与裸 message 文本：有的调用点只拿到字符串形式的报错。
 */
export function isNetworkFailure(error: unknown): boolean {
  if (error instanceof Error) {
    return NETWORK_FAILURE_PATTERN.test(error.message);
  }

  return typeof error === 'string' && NETWORK_FAILURE_PATTERN.test(error);
}

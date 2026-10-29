/**
 * 卡片上的相对更新时间。只做展示，措辞不进测试契约（spec 测试决定）。
 */
export function formatRelativeTime(updatedAt: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - updatedAt);
  const minutes = Math.floor(diff / 60_000);

  if (minutes < 1) {
    return '刚刚';
  }

  if (minutes < 60) {
    return `${minutes} 分钟前`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours} 小时前`;
  }

  return `${Math.floor(hours / 24)} 天前`;
}

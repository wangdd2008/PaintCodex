const MAX_SVG_LENGTH = 200_000;

/**
 * Phase 1 accepts only standalone, passive SVG. Fabric parses the markup; this
 * guard keeps scripts, event handlers, embedded images, and remote references
 * out of stored layers. It is the tool argument validator now that the marker
 * parser is gone.
 */
export function isSafeSvg(svg: string): boolean {
  return unsafeSvgReason(svg) === null;
}

/** Returns why an SVG is unsafe, or null when it passes {@link isSafeSvg}. */
export function unsafeSvgReason(svg: string): string | null {
  if (svg.length === 0 || svg.length > MAX_SVG_LENGTH) {
    return `SVG 长度必须在 1 到 ${MAX_SVG_LENGTH} 个字符之间`;
  }

  const lower = svg.toLowerCase();

  if (!lower.startsWith('<svg') || !lower.endsWith('</svg>')) {
    return 'SVG 必须是完整的 <svg> 文档';
  }

  if (lower.includes('<script') || lower.includes('<foreignobject')) {
    return 'SVG 不能包含 <script> 或 <foreignObject>';
  }

  if (lower.includes('<image') || lower.includes('<style')) {
    return 'SVG 不能包含 <image> 或 <style>';
  }

  if (lower.includes('javascript:')) {
    return 'SVG 不能包含 javascript: URL';
  }

  if (/\son[a-z]+\s*=/.test(lower)) {
    return 'SVG 不能包含事件处理属性';
  }

  if (/(?:href|src)\s*=\s*["'](?:https?:)?\/\//i.test(svg)) {
    return 'SVG 不能引用远程资源';
  }

  if (/url\s*\(\s*["']?(?:https?:)?\/\//i.test(svg)) {
    return 'SVG 不能引用远程资源';
  }

  if (/url\s*\(\s*["']?data:/i.test(svg)) {
    return 'SVG 不能引用 data: 资源';
  }

  return null;
}

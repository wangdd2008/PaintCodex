import { CANVAS_ACTION_MARKER } from '@paintcodex/protocol';

export { CANVAS_ACTION_MARKER };

const MAX_SVG_LENGTH = 200_000;

export interface CanvasAction {
  name: string;
  svg: string;
}

/**
 * Extracts the single canvas action Codex appends after {@link CANVAS_ACTION_MARKER}.
 * Returns null for ordinary chat or malformed output.
 */
export function parseCanvasAction(text: string): CanvasAction | null {
  const markerIndex = text.indexOf(CANVAS_ACTION_MARKER);

  if (markerIndex < 0) {
    return null;
  }

  let payload = text.slice(markerIndex + CANVAS_ACTION_MARKER.length).trim();
  payload = payload
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  const start = payload.indexOf('{');
  const end = payload.lastIndexOf('}');

  if (start < 0 || end <= start) {
    return null;
  }

  try {
    const parsed = JSON.parse(payload.slice(start, end + 1)) as {
      name?: unknown;
      svg?: unknown;
    };

    if (typeof parsed.name !== 'string' || typeof parsed.svg !== 'string') {
      return null;
    }

    const name = parsed.name.trim().slice(0, 80);
    const svg = parsed.svg.trim();

    if (name.length === 0 || !isSafeSvg(svg)) {
      return null;
    }

    return { name, svg };
  } catch {
    return null;
  }
}

/**
 * Phase 1 accepts only standalone, passive SVG. Fabric parses the markup; this
 * guard keeps scripts, event handlers, embedded images, and remote references
 * out of stored layers.
 */
export function isSafeSvg(svg: string): boolean {
  if (svg.length === 0 || svg.length > MAX_SVG_LENGTH) {
    return false;
  }

  const lower = svg.toLowerCase();

  if (!lower.startsWith('<svg') || !lower.endsWith('</svg>')) {
    return false;
  }

  if (lower.includes('<script') || lower.includes('<foreignobject')) {
    return false;
  }

  if (lower.includes('<image')) {
    return false;
  }

  if (lower.includes('javascript:')) {
    return false;
  }

  if (/\son[a-z]+\s*=/.test(lower)) {
    return false;
  }

  if (/(?:href|src)\s*=\s*["'](?:https?:)?\/\//i.test(svg)) {
    return false;
  }

  return true;
}

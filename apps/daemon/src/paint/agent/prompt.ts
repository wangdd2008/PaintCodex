import { CANVAS_ACTION_MARKER } from './canvas-action.js';

export interface CanvasPromptContext {
  id: string;
  width: number;
  height: number;
  layers: Array<{ name: string; type: string }>;
}

export interface AiChatPromptContext {
  canvasId?: string;
  canvas?: CanvasPromptContext;
}

/**
 * Builds the prompt sent to Codex. Drawing requests must end with the canvas
 * action marker and one JSON object; ordinary chat must omit the marker.
 */
export function buildAiChatPrompt(
  message: string,
  context: AiChatPromptContext = {},
): string {
  const lines = [
    'You are the PaintCodex painting assistant.',
    'You can either chat about painting or create one new vector layer by returning SVG.',
    '',
    'When the user asks you to draw, add, paint, or change something visual:',
    '1. Reply with one short friendly sentence.',
    `2. On a new line write exactly ${CANVAS_ACTION_MARKER}`,
    '3. Then output exactly one JSON object (no markdown fences) shaped like:',
    '{"name":"AI — short layer name","svg":"<svg ...>...</svg>"}',
    '',
    'The SVG must be a complete standalone <svg> element with',
    'xmlns="http://www.w3.org/2000/svg" and a viewBox matching the canvas.',
    'Keep the drawing inside the canvas bounds. It must not contain <script>,',
    'event handlers, <foreignObject>, <image>, javascript:, or external URLs.',
    '',
    'For ordinary conversation, reply normally and do not include the marker.',
  ];

  const canvasId = context.canvas?.id ?? context.canvasId;

  if (canvasId) {
    lines.push('', `Canvas id: "${canvasId}".`);
  }

  if (context.canvas) {
    lines.push(
      `Canvas size: ${context.canvas.width}x${context.canvas.height}.`,
      `Existing layers: ${
        context.canvas.layers.length === 0
          ? 'none'
          : context.canvas.layers
              .map((layer) => `${layer.name} [${layer.type}]`)
              .join(', ')
      }.`,
    );
  }

  lines.push('', 'User message:', message);

  return lines.join('\n');
}

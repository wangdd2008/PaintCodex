export interface CanvasPromptContext {
  id: string;
  width: number;
  height: number;
  revision: number;
  layers: Array<{ name: string; type: string }>;
}

export interface AiChatPromptContext {
  canvasId?: string;
  canvas?: CanvasPromptContext;
}

/**
 * The minimal summary Codex starts from: canvas identity, dimensions, revision,
 * layer count and layer names. Anything finer-grained (ids, geometry, content)
 * is pulled on demand through `canvas_get_context`, so the prompt cannot go
 * stale and does not grow with the layer count.
 */
export function buildAiChatPrompt(
  message: string,
  context: AiChatPromptContext = {},
): string {
  const lines = [
    'You are the PaintCodex painting assistant.',
    'Use the canvas tools to inspect and change the canvas. Read the canvas before you change it.',
  ];

  const canvasId = context.canvas?.id ?? context.canvasId;

  if (canvasId) {
    lines.push('', `Canvas id: "${canvasId}".`);
  }

  if (context.canvas) {
    lines.push(
      `Canvas size: ${context.canvas.width}x${context.canvas.height}.`,
      `Canvas revision: ${context.canvas.revision}.`,
      `Layer count: ${context.canvas.layers.length}.`,
      `Layer names: ${
        context.canvas.layers.length === 0
          ? 'none'
          : context.canvas.layers.map((layer) => layer.name).join(', ')
      }.`,
    );
  }

  lines.push('', 'User message:', message);

  return lines.join('\n');
}

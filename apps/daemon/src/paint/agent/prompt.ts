/**
 * Builds the prompt sent to Codex. Ticket 07 is conversational only: the
 * assistant must not emit canvas tool calls or SVG yet (Ticket 08 adds that).
 */
export function buildAiChatPrompt(message: string, canvasId?: string): string {
  const lines = [
    'You are the PaintCodex painting assistant.',
    'Answer the user conversationally about painting: composition, color, technique, and what to paint next.',
    'Do not emit canvas tool calls, SVG markup, JSON commands, or layer operations; reply with plain assistant text only.',
  ];

  if (canvasId) {
    lines.push(`Canvas context: the user is working on canvas id "${canvasId}".`);
  }

  lines.push('', 'User message:', message);

  return lines.join('\n');
}

import type {
  CodexRuntime,
  CodexTurnInput,
  CodexTurnResult,
} from '../../src/paint/agent/runtime/codex-runtime.js';

/** An in-process Codex seam so route tests never spawn a real CLI. */
export function fakeRuntime(
  handler: (input: CodexTurnInput) => Promise<CodexTurnResult> | CodexTurnResult,
  captures: { input?: CodexTurnInput } = {},
): CodexRuntime {
  return {
    async startTurn(input) {
      captures.input = input;

      return handler(input);
    },
    async interrupt() {},
    getThreadId: () => null,
    getActiveTurn: () => null,
    async deleteThread() {},
    async close() {},
  };
}

import { randomUUID } from 'node:crypto';
import type { StreamPayload } from '@paintcodex/protocol';
import type { ObservabilityLogger, TraceContext } from '../../../observability/logger.js';

/** One `confirm` SSE frame; the protocol owns the shape. */
export type ConfirmFrameEvent = NonNullable<StreamPayload['confirm']>;

/**
 * How a suspended confirmation ended. Only `approved` lets the tool continue;
 * every other value reaches the model as `user_declined`, with a message that
 * names what actually happened.
 */
export type ConfirmationOutcome =
  | 'approved'
  | 'declined'
  | 'timeout'
  | 'disconnected'
  | 'interrupted';

export type ConfirmationCancelReason = 'disconnected' | 'interrupted';

export interface ConfirmationRequest {
  /** Short question shown as the confirmation bar's heading. */
  title: string;
  /** One sentence explaining what happens if approved. */
  detail: string;
}

export interface ConfirmationRequestOptions {
  /** Sink for the frame the web renders; a missing sink is a headless client. */
  onConfirm?(event: ConfirmFrameEvent): void;
  trace?: TraceContext;
  /** Aborts the wait when the chat request or the turn goes away. */
  signal?: AbortSignal;
}

export interface ConfirmationAnswer {
  /** `duplicate` means the request was already settled; the first outcome stands. */
  status: 'approved' | 'declined' | 'duplicate';
  outcome: ConfirmationOutcome;
}

/**
 * The human side of a dangerous tool call. A tool asks, the HTTP endpoint
 * answers, and the asker always settles: answered, timed out, or cancelled by a
 * disconnect, an interrupt or daemon shutdown.
 */
export interface ConfirmationChannel {
  /**
   * Ask the user and wait. The call resolves only when the answer is known or
   * the deadline/cancellation forces a refusal, so a suspended tool can never
   * hang its thread.
   */
  requestConfirmation(
    canvasId: string,
    request: ConfirmationRequest,
    options?: ConfirmationRequestOptions,
  ): Promise<ConfirmationOutcome>;
  /**
   * Answer one request. Returns `null` for an unknown id **or** for a request
   * that belongs to another canvas: an unrelated tab cannot approve it.
   */
  answer(
    requestId: string,
    approved: boolean,
    canvasId?: string,
  ): ConfirmationAnswer | null;
  /** Refuses every pending request of one canvas; used by interrupt/disconnect. */
  cancelCanvas(canvasId: string, reason: ConfirmationCancelReason): void;
  /** Refuses everything; used when the runtime or the daemon goes away. */
  cancelAll(reason: ConfirmationCancelReason): void;
  /** Unsettled requests only; settled ones linger briefly for idempotent answers. */
  pendingCount(): number;
  close(): void;
}

export interface ConfirmationChannelOptions {
  /** Defaults to 60s, the policy both the daemon and the web follow. */
  timeoutMs?: number;
  /** How long a settled request stays answerable so a repeated click is a no-op. */
  settledRetentionMs?: number;
  logger?: ObservabilityLogger;
}

export const CONFIRMATION_TIMEOUT_MS = 60_000;
const DEFAULT_SETTLED_RETENTION_MS = 5 * 60_000;

interface PendingEntry {
  id: string;
  canvasId: string;
  title: string;
  detail: string;
  trace?: TraceContext;
  resolve(outcome: ConfirmationOutcome): void;
  timer: NodeJS.Timeout;
  retentionTimer?: NodeJS.Timeout;
  signal?: AbortSignal;
  onAbort?: () => void;
  settled: boolean;
  outcome?: ConfirmationOutcome;
}

export function createConfirmationChannel(
  options: ConfirmationChannelOptions = {},
): ConfirmationChannel {
  const timeoutMs = options.timeoutMs ?? CONFIRMATION_TIMEOUT_MS;
  const settledRetentionMs =
    options.settledRetentionMs ?? DEFAULT_SETTLED_RETENTION_MS;
  const entries = new Map<string, PendingEntry>();

  const log = (
    level: 'info' | 'warn' | 'error',
    message: string,
    entry: Pick<PendingEntry, 'id' | 'canvasId' | 'trace'>,
    payload: Record<string, unknown>,
  ) => {
    options.logger?.log({
      category: 'codex-runtime',
      level,
      message,
      payload,
      canvasId: entry.canvasId,
      actor: 'agent',
      traceId: entry.trace?.traceId ?? null,
      parentId: entry.trace?.spanId ?? null,
    });
  };

  const settle = (entry: PendingEntry, outcome: ConfirmationOutcome) => {
    if (entry.settled) {
      return;
    }

    entry.settled = true;
    entry.outcome = outcome;
    clearTimeout(entry.timer);

    if (entry.signal && entry.onAbort) {
      entry.signal.removeEventListener('abort', entry.onAbort);
    }

    entry.resolve(outcome);

    // Keep the id answerable for a while: a double click or a retried request
    // must be idempotent instead of turning into a 404.
    entry.retentionTimer = setTimeout(() => {
      entries.delete(entry.id);
    }, settledRetentionMs);
    entry.retentionTimer.unref?.();
  };

  const requestConfirmation: ConfirmationChannel['requestConfirmation'] = (
    canvasId,
    request,
    requestOptions = {},
  ) =>
    new Promise<ConfirmationOutcome>((resolve) => {
      if (requestOptions.signal?.aborted) {
        resolve('disconnected');
        return;
      }

      const id = randomUUID();
      const entry: PendingEntry = {
        id,
        canvasId,
        title: request.title,
        detail: request.detail,
        trace: requestOptions.trace,
        resolve,
        timer: setTimeout(() => {
          log('warn', 'confirmation_timeout', entry, {
            requestId: id,
            timeoutMs,
          });
          settle(entry, 'timeout');
        }, timeoutMs),
        settled: false,
      };

      entry.timer.unref?.();
      entries.set(id, entry);

      if (requestOptions.signal) {
        entry.signal = requestOptions.signal;
        entry.onAbort = () => {
          log('warn', 'confirmation_cancelled', entry, {
            requestId: id,
            reason: 'disconnected',
          });
          settle(entry, 'disconnected');
        };
        requestOptions.signal.addEventListener('abort', entry.onAbort, {
          once: true,
        });
      }

      log('info', 'confirmation_requested', entry, {
        requestId: id,
        title: request.title,
      });

      try {
        requestOptions.onConfirm?.({ id, title: request.title, detail: request.detail });
      } catch (error) {
        // A broken sink must not leave the tool suspended with no way to answer.
        log('error', 'confirmation_emit_failed', entry, {
          requestId: id,
          error: error instanceof Error ? error.message : String(error),
        });
        settle(entry, 'disconnected');
      }
    });

  const answer: ConfirmationChannel['answer'] = (
    requestId,
    approved,
    canvasId,
  ) => {
    const entry = entries.get(requestId);

    if (!entry) {
      return null;
    }

    if (canvasId !== undefined && canvasId !== entry.canvasId) {
      log('warn', 'confirmation_canvas_mismatch', entry, {
        requestId,
        answeredCanvasId: canvasId,
      });
      return null;
    }

    if (entry.settled) {
      log('info', 'confirmation_answer_ignored', entry, {
        requestId,
        outcome: entry.outcome,
      });

      return {
        status: 'duplicate',
        outcome: entry.outcome ?? 'interrupted',
      };
    }

    const outcome: ConfirmationOutcome = approved ? 'approved' : 'declined';

    log('info', 'confirmation_answered', entry, {
      requestId,
      approved,
      outcome,
    });
    settle(entry, outcome);

    return { status: outcome, outcome };
  };

  return {
    requestConfirmation,
    answer,

    cancelCanvas(canvasId, reason) {
      for (const entry of entries.values()) {
        if (!entry.settled && entry.canvasId === canvasId) {
          log('warn', 'confirmation_cancelled', entry, {
            requestId: entry.id,
            reason,
          });
          settle(entry, reason);
        }
      }
    },

    cancelAll(reason) {
      for (const entry of entries.values()) {
        if (!entry.settled) {
          log('warn', 'confirmation_cancelled', entry, {
            requestId: entry.id,
            reason,
          });
          settle(entry, reason);
        }
      }
    },

    pendingCount() {
      let count = 0;

      for (const entry of entries.values()) {
        if (!entry.settled) {
          count += 1;
        }
      }

      return count;
    },

    close() {
      for (const entry of entries.values()) {
        if (!entry.settled) {
          settle(entry, 'interrupted');
        }

        if (entry.retentionTimer) {
          clearTimeout(entry.retentionTimer);
        }
      }

      entries.clear();
    },
  };
}

import { randomUUID } from 'node:crypto';
import type { Actor, AgentLog, LogCategory, LogLevel } from '@paintcodex/protocol';
import type { ObservabilityEvents } from './events.js';
import type { AgentLogRepository } from './repository.js';
import type { NewAgentLogRecord } from './types.js';

export interface ObservabilityLoggerOptions {
  /** Injectable clock, used by tests to assert span durations. */
  now?: () => number;
  /** Injectable ID source, used by tests to assert trace trees. */
  newId?: () => string;
}

export interface SpanStart {
  category: LogCategory;
  message: string;
  payload?: unknown;
  canvasId?: string | null;
  revision?: number | null;
  actor?: Actor | null;
}

export interface LoggerLogInput {
  category: LogCategory;
  message: string;
  level?: LogLevel;
  payload?: unknown;
  durationMs?: number | null;
  error?: unknown;
  canvasId?: string | null;
  revision?: number | null;
  actor?: Actor | null;
  traceId?: string | null;
  spanId?: string | null;
  parentId?: string | null;
  timestamp?: number;
}

export interface TraceContext {
  traceId: string;
  spanId: string;
}

export interface SpanFinishInput {
  level?: LogLevel;
  message?: string;
  payload?: unknown;
  error?: unknown;
  durationMs?: number;
}

const MAX_ERROR_LENGTH = 4000;

/**
 * The daemon owns exactly one instance per server (created in `buildServer`),
 * so every instrumentation point shares the same repository and event bus.
 */
export class ObservabilityLogger {
  constructor(
    readonly repository: AgentLogRepository,
    private readonly events: ObservabilityEvents,
    private readonly options: ObservabilityLoggerOptions = {},
  ) {}

  now(): number {
    return (this.options.now ?? Date.now)();
  }

  newId(): string {
    return (this.options.newId ?? randomUUID)();
  }

  log(input: LoggerLogInput): AgentLog {
    const traceId = input.traceId ?? null;
    let spanId = input.spanId ?? null;

    if (spanId === null && traceId !== null) {
      spanId = this.newId();
    }

    const record: NewAgentLogRecord = {
      traceId,
      spanId,
      parentId: input.parentId ?? null,
      timestamp: input.timestamp ?? this.now(),
      level: input.level ?? 'info',
      category: input.category,
      message: input.message,
      payload: input.payload,
      durationMs: input.durationMs ?? null,
      error: toErrorText(input.error),
      canvasId: input.canvasId ?? null,
      revision: input.revision ?? null,
      actor: input.actor ?? null,
    };

    const log = this.repository.insert(record);
    this.events.publish(log);

    return log;
  }

  startTrace(input: SpanStart): ObservabilitySpan {
    return new ObservabilitySpan(
      this,
      this.newId(),
      this.newId(),
      null,
      input,
      this.now(),
    );
  }

  startSpan(parent: TraceContext, input: SpanStart): ObservabilitySpan {
    return new ObservabilitySpan(
      this,
      parent.traceId,
      this.newId(),
      parent.spanId,
      input,
      this.now(),
    );
  }
}

/**
 * One timed unit of work. `finish()` writes the span record; `log()` writes a
 * point event as a child node so the monitor can render it inside the tree.
 */
export class ObservabilitySpan implements TraceContext {
  constructor(
    private readonly logger: ObservabilityLogger,
    readonly traceId: string,
    readonly spanId: string,
    readonly parentId: string | null,
    private readonly start: SpanStart,
    readonly startedAt: number,
  ) {}

  log(
    input: Omit<LoggerLogInput, 'traceId' | 'spanId' | 'parentId' | 'category'> & {
      category?: LogCategory;
    },
  ): AgentLog {
    return this.logger.log({
      ...this.context(),
      ...input,
      category: input.category ?? this.start.category,
      traceId: this.traceId,
      spanId: this.logger.newId(),
      parentId: this.spanId,
    });
  }

  startSpan(input: SpanStart): ObservabilitySpan {
    return this.logger.startSpan(this, input);
  }

  finish(input: SpanFinishInput = {}): AgentLog {
    return this.logger.log({
      ...this.context(),
      ...input,
      category: this.start.category,
      message: input.message ?? this.start.message,
      traceId: this.traceId,
      spanId: this.spanId,
      parentId: this.parentId,
      timestamp: this.startedAt,
      durationMs: input.durationMs ?? this.logger.now() - this.startedAt,
    });
  }

  private context(): {
    payload: unknown;
    canvasId: string | null;
    revision: number | null;
    actor: Actor | null;
  } {
    return {
      payload: this.start.payload,
      canvasId: this.start.canvasId ?? null,
      revision: this.start.revision ?? null,
      actor: this.start.actor ?? null,
    };
  }
}

function toErrorText(error: unknown): string | null {
  if (error === undefined || error === null) {
    return null;
  }

  const text = error instanceof Error ? error.message : String(error);

  return text.slice(0, MAX_ERROR_LENGTH);
}

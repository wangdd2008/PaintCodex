import type { DatabaseConnection } from '../storage/database.js';
import { ObservabilityEvents } from './events.js';
import {
  ObservabilityLogger,
  type ObservabilityLoggerOptions,
} from './logger.js';
import { AgentLogRepository } from './repository.js';

export interface Observability {
  repository: AgentLogRepository;
  events: ObservabilityEvents;
  logger: ObservabilityLogger;
}

export function createObservability(
  db: DatabaseConnection,
  options: ObservabilityLoggerOptions = {},
): Observability {
  const repository = new AgentLogRepository(db);
  const events = new ObservabilityEvents();
  const logger = new ObservabilityLogger(repository, events, options);

  return { repository, events, logger };
}

export { ObservabilityEvents } from './events.js';
export {
  ObservabilityLogger,
  ObservabilitySpan,
  type LoggerLogInput,
  type SpanFinishInput,
  type SpanStart,
  type TraceContext,
} from './logger.js';
export { AgentLogRepository } from './repository.js';
export {
  clearRequestSpan,
  getRequestSpan,
  setRequestSpan,
} from './request-context.js';
export type {
  AgentLogQuery,
  AgentLogStatsOptions,
  NewAgentLogRecord,
} from './types.js';

import type { AgentLog } from '@paintcodex/protocol';

export type AgentLogListener = (log: AgentLog) => void;

/**
 * In-process fan-out from the logger to live consumers such as the monitor
 * SSE endpoint. Slow or throwing listeners must never break log writes.
 */
export class ObservabilityEvents {
  private readonly listeners = new Set<AgentLogListener>();

  subscribe(listener: AgentLogListener): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  publish(log: AgentLog): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(log);
      } catch {
        // A broken subscriber is isolated so the write path stays healthy.
      }
    }
  }

  listenerCount(): number {
    return this.listeners.size;
  }
}

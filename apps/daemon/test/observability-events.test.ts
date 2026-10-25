import { describe, expect, it, vi } from 'vitest';
import type { AgentLog } from '@paintcodex/protocol';
import { ObservabilityEvents } from '../src/observability/events.js';

const log: AgentLog = {
  id: 1,
  traceId: null,
  spanId: null,
  parentId: null,
  timestamp: 1,
  level: 'info',
  category: 'system',
  message: 'event',
  payload: null,
  durationMs: null,
  error: null,
  canvasId: null,
  revision: null,
  actor: null,
};

describe('ObservabilityEvents', () => {
  it('publishes to every subscriber and stops after unsubscribe', () => {
    const events = new ObservabilityEvents();
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = events.subscribe(first);

    events.subscribe(second);
    events.publish(log);

    expect(first).toHaveBeenCalledWith(log);
    expect(second).toHaveBeenCalledWith(log);
    expect(events.listenerCount()).toBe(2);

    unsubscribeFirst();
    events.publish({ ...log, id: 2 });

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
    expect(events.listenerCount()).toBe(1);
  });

  it('isolates a throwing subscriber from the rest', () => {
    const events = new ObservabilityEvents();
    const healthy = vi.fn();

    events.subscribe(() => {
      throw new Error('broken subscriber');
    });
    events.subscribe(healthy);

    expect(() => events.publish(log)).not.toThrow();
    expect(healthy).toHaveBeenCalledWith(log);
  });
});

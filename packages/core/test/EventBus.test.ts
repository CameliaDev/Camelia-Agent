import { describe, expect, it, vi } from 'vitest';

import { EventBus } from '../src/events/EventBus.js';
import type { DomainEvent } from '../src/types/events.js';

const meta = { traceId: 't1', sessionId: 's1', taskId: 'task1' };

describe('EventBus', () => {
  it('delivers an event to a typed subscriber', () => {
    const bus = new EventBus();
    const seen: string[] = [];
    bus.on('task.received', (e) => seen.push(e.payload.task.id));
    bus.emit('task.received', {
      task: {
        id: 'task1',
        sessionId: 's1',
        intentRaw: 'do it',
        status: 'received',
        phase: 'planning',
        progress: 0,
        createdAt: 0,
        updatedAt: 0,
      },
    }, meta);
    expect(seen).toEqual(['task1']);
  });

  it('only notifies subscribers of the matching type', () => {
    const bus = new EventBus();
    const a = vi.fn();
    const b = vi.fn();
    bus.on('task.paused', a);
    bus.on('task.resumed', b);
    bus.emit('task.paused', { reason: 'user' }, meta);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
  });

  it('notifies onAny subscribers for every event', () => {
    const bus = new EventBus();
    const any = vi.fn();
    bus.onAny(any);
    bus.emit('task.paused', { reason: 'a' }, meta);
    bus.emit('task.cancelled', { reason: 'b' }, meta);
    expect(any).toHaveBeenCalledTimes(2);
  });

  it('stamps the envelope with traceId, sessionId, taskId and ts', () => {
    const bus = new EventBus();
    const event = bus.emit('task.progress', { progress: 0.5, currentStepIdx: 1, totalSteps: 2 }, meta);
    expect(event.traceId).toBe('t1');
    expect(event.sessionId).toBe('s1');
    expect(event.taskId).toBe('task1');
    expect(event.ts).toBeGreaterThan(0);
  });

  it('unsubscribes via the returned handle', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    const off = bus.on('task.paused', handler);
    bus.emit('task.paused', { reason: 'a' }, meta);
    off();
    bus.emit('task.paused', { reason: 'b' }, meta);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('supports once()', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.once('task.paused', handler);
    bus.emit('task.paused', { reason: 'a' }, meta);
    bus.emit('task.paused', { reason: 'b' }, meta);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('calls the onEmit hook before subscribers', () => {
    const order: string[] = [];
    const bus = new EventBus({ onEmit: () => order.push('hook') });
    bus.on('task.paused', () => order.push('sub'));
    bus.emit('task.paused', { reason: 'a' }, meta);
    expect(order).toEqual(['hook', 'sub']);
  });

  it('isolates a throwing subscriber so others still receive the event', () => {
    const onSubscriberError = vi.fn();
    const bus = new EventBus({ onSubscriberError });
    const good = vi.fn();
    bus.on('task.paused', () => {
      throw new Error('boom');
    });
    bus.on('task.paused', good);
    expect(() => bus.emit('task.paused', { reason: 'a' }, meta)).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
    expect(onSubscriberError).toHaveBeenCalledTimes(1);
  });

  it('reports listener counts and clears', () => {
    const bus = new EventBus();
    bus.on('task.paused', () => {});
    bus.onAny(() => {});
    expect(bus.listenerCount('task.paused')).toBe(1);
    expect(bus.listenerCount()).toBe(2);
    bus.clear();
    expect(bus.listenerCount()).toBe(0);
  });

  it('emitEvent accepts a pre-built event', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.onAny(handler);
    const event: DomainEvent = {
      type: 'task.cancelled',
      payload: { reason: 'x' },
      traceId: 't',
      ts: 1,
    };
    bus.emitEvent(event);
    expect(handler).toHaveBeenCalledWith(event);
  });

  it('tolerates a subscriber unsubscribing during dispatch', () => {
    const bus = new EventBus();
    const second = vi.fn();
    const off = bus.on('task.paused', () => off());
    bus.on('task.paused', second);
    bus.emit('task.paused', { reason: 'a' }, meta);
    expect(second).toHaveBeenCalledTimes(1);
  });
});
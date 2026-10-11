/**
 * Type-safe event bus — the single sanctioned transport across layers.
 * @module
 */

import type { Id } from '../types/common.js';
import type { DomainEvent, DomainEventMap, DomainEventOf, DomainEventType } from '../types/events.js';

export type Unsubscribe = () => void;

export interface EmitMeta {
  traceId: string;
  sessionId?: Id;
  taskId?: Id;
  ts?: number;
}

export interface EventBusOptions {
  /** Called for every emitted event, in order. Used to persist the event log. */
  onEmit?: (event: DomainEvent) => void;
  /** Called when a subscriber throws. A broken subscriber must never break emission. */
  onSubscriberError?: (error: unknown, event: DomainEvent) => void;
}

/**
 * Minimal synchronous pub/sub with full type inference on `type`.
 *
 * Synchronous by design: events describe facts that already happened, and
 * persistence must observe them in a deterministic order before the next step runs.
 */
export class EventBus {
  private readonly handlers = new Map<string, Set<(event: never) => void>>();
  private readonly anyHandlers = new Set<(event: DomainEvent) => void>();
  private readonly onEmit?: (event: DomainEvent) => void;
  private readonly onSubscriberError?: (error: unknown, event: DomainEvent) => void;

  constructor(options: EventBusOptions = {}) {
    this.onEmit = options.onEmit;
    this.onSubscriberError = options.onSubscriberError;
  }

  /** Subscribe to one event type. Returns an unsubscribe function. */
  on<T extends DomainEventType>(type: T, handler: (event: DomainEventOf<T>) => void): Unsubscribe {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    const h = handler as unknown as (event: never) => void;
    set.add(h);
    return () => {
      set?.delete(h);
    };
  }

  /** Subscribe to every event. Used by persistence, tracing and the UI projector. */
  onAny(handler: (event: DomainEvent) => void): Unsubscribe {
    this.anyHandlers.add(handler);
    return () => {
      this.anyHandlers.delete(handler);
    };
  }

  /** Subscribe to exactly one delivery, then auto-unsubscribe. */
  once<T extends DomainEventType>(type: T, handler: (event: DomainEventOf<T>) => void): Unsubscribe {
    const off = this.on(type, (event) => {
      off();
      handler(event);
    });
    return off;
  }

  /** Build and emit an event in one call. */
  emit<T extends DomainEventType>(
    type: T,
    payload: DomainEventMap[T],
    meta: EmitMeta,
  ): DomainEventOf<T> {
    const event = {
      type,
      payload,
      traceId: meta.traceId,
      sessionId: meta.sessionId,
      taskId: meta.taskId,
      ts: meta.ts ?? Date.now(),
    } as DomainEventOf<T>;
    // A generic `T` is not provably assignable to the discriminated union, so the
    // widening is done once here rather than leaking into every call site.
    this.emitEvent(event as unknown as DomainEvent);
    return event;
  }

  /** Emit a pre-built event. */
  emitEvent(event: DomainEvent): void {
    this.onEmit?.(event);
    const typed = this.handlers.get(event.type);
    if (typed) {
      for (const handler of [...typed]) {
        this.invoke(handler as unknown as (e: DomainEvent) => void, event);
      }
    }
    for (const handler of [...this.anyHandlers]) {
      this.invoke(handler, event);
    }
  }

  /** Number of registered handlers (all types when `type` is omitted). */
  listenerCount(type?: DomainEventType): number {
    if (type) return this.handlers.get(type)?.size ?? 0;
    let total = this.anyHandlers.size;
    for (const set of this.handlers.values()) total += set.size;
    return total;
  }

  /** Drop every subscriber. */
  clear(): void {
    this.handlers.clear();
    this.anyHandlers.clear();
  }

  private invoke(handler: (event: DomainEvent) => void, event: DomainEvent): void {
    try {
      handler(event);
    } catch (error) {
      this.onSubscriberError?.(error, event);
    }
  }
}
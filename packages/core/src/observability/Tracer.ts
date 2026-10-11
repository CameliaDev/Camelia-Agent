/**
 * Tracing — the causal spine of a task.
 *
 * Every command and event carries a `traceId`; spans reconstruct the
 * task -> step -> tool-call causal tree (whitepaper §3.10, metric M14).
 * @module
 */

import type { JsonValue } from '../types/common.js';
import { newId, shortId } from '../utils/id.js';

export type SpanId = string;
export type SpanStatus = 'ok' | 'error' | 'cancelled';

export interface Span {
  id: SpanId;
  name: string;
  traceId: string;
  parentId?: SpanId;
  startedAt: number;
  endedAt?: number;
  status?: SpanStatus;
  attributes: Record<string, JsonValue>;
}

export interface StartSpanOptions {
  traceId?: string;
  parentId?: SpanId;
  attributes?: Record<string, JsonValue>;
}

export interface TracerPort {
  startSpan(name: string, options?: StartSpanOptions): Span;
  end(span: Span, status?: SpanStatus, attributes?: Record<string, JsonValue>): void;
  getSpan(id: SpanId): Span | undefined;
  spans(): readonly Span[];
  childrenOf(id: SpanId): readonly Span[];
  /** Fraction of spans whose parent (if declared) resolves. 1 means a complete causal tree. */
  traceCompleteness(): number;
  reset(): void;
}

export class InMemoryTracer implements TracerPort {
  private readonly store = new Map<SpanId, Span>();

  startSpan(name: string, options: StartSpanOptions = {}): Span {
    const traceId = options.traceId ?? shortId(12);
    const span: Span = {
      id: newId(),
      name,
      traceId,
      parentId: options.parentId,
      startedAt: Date.now(),
      attributes: { ...(options.attributes ?? {}) },
    };
    this.store.set(span.id, span);
    return span;
  }

  end(span: Span, status: SpanStatus = 'ok', attributes?: Record<string, JsonValue>): void {
    const existing = this.store.get(span.id);
    if (!existing) {
      // Span was created by a different tracer instance; record it so it isn't lost.
      this.store.set(span.id, span);
    }
    const target = this.store.get(span.id)!;
    target.endedAt = Date.now();
    target.status = status;
    if (attributes) Object.assign(target.attributes, attributes);
  }

  getSpan(id: SpanId): Span | undefined {
    return this.store.get(id);
  }

  spans(): readonly Span[] {
    return [...this.store.values()];
  }

  childrenOf(id: SpanId): readonly Span[] {
    return this.spans().filter((s) => s.parentId === id);
  }

  traceCompleteness(): number {
    const all = this.spans();
    if (all.length === 0) return 1;
    let resolvable = 0;
    for (const span of all) {
      if (!span.parentId || this.store.has(span.parentId)) resolvable += 1;
    }
    return resolvable / all.length;
  }

  reset(): void {
    this.store.clear();
  }
}
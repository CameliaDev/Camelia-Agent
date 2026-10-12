/**
 * Memory service — lifecycle, value-driven forgetting and reactivation.
 *
 * Owns the *policy* side of memory (whitepaper §2.2: core stores, harness
 * decides). Every decision is observable: writes emit `memory.written`,
 * recalls emit `memory.recalled` (with a recall-noise metric), evictions and
 * explicit forgets write an audit trail (`memory_forget_log`) and emit
 * `memory.forgotten`, and due high-value memories emit `memory.reactivated`.
 *
 * Forgetting is value-driven: only items marked `retrievable` (re-fetchable
 * syntax/API detail, docs) can be mechanically evicted under budget pressure;
 * lessons, constraints and project facts (`retrievable = false`) never are.
 * @module
 */

import type {
  ClockPort,
  EmitMeta,
  EventBus,
  ForgetLogEntry,
  Id,
  LoggerPort,
  MemoryEvidence,
  MemoryItem,
  MemoryLayer,
  MemoryPatch,
  MemoryQuery,
  MetricsPort,
  SessionStore,
  Timestamp,
} from '@camelia/core';
import { newId } from '@camelia/core';

import {
  halfLifeOf,
  memoryValue,
  nextReviewAt,
  recencyScore,
  tokens,
  DEFAULT_HALF_LIFE_MS,
  type MemoryValueInput,
} from './value.js';
import {
  buildRecallTimeline,
  computeRecallNoiseAggregate,
  type RecallNoiseAggregate,
  type RecallTimelineHit,
} from './recallNoise.js';

export interface MemoryWriteInput {
  scope: MemoryItem['scope'];
  sessionId?: Id;
  kind: MemoryItem['kind'];
  content: string;
  keywords: string;
  importance?: number;
  ttl?: number | null;
  retrievable?: boolean;
  correctness?: number;
  layer?: MemoryLayer;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface MemoryServiceOptions {
  store: SessionStore;
  bus: EventBus;
  logger?: LoggerPort;
  metrics?: MetricsPort;
  clock: ClockPort;
  /** Max persistent memory items; over budget, lowest-value retrievable items are evicted. */
  budget?: number;
  /** Half-life of the recency curve (tests inject small values). */
  halfLifeMs?: number;
  /** Event metadata for everything this service emits. */
  meta: EmitMeta;
}

/** Filters for the recall timeline query (all optional). */
export interface RecallTimelineQuery {
  memoryId?: Id;
  sessionId?: Id;
  since?: number;
  limit?: number;
}

/** Default per-scope persistent memory budget. */
export const DEFAULT_MEMORY_BUDGET = 200;

export class MemoryService {
  private readonly store: SessionStore;
  private readonly bus: EventBus;
  private readonly logger?: LoggerPort;
  private readonly metrics?: MetricsPort;
  private readonly clock: ClockPort;
  private readonly budget: number;
  private readonly halfLifeMs: number;
  private readonly meta: EmitMeta;

  constructor(options: MemoryServiceOptions) {
    this.store = options.store;
    this.bus = options.bus;
    this.logger = options.logger;
    this.metrics = options.metrics;
    this.clock = options.clock;
    this.budget = options.budget ?? DEFAULT_MEMORY_BUDGET;
    this.halfLifeMs = options.halfLifeMs ?? DEFAULT_HALF_LIFE_MS;
    this.meta = options.meta;
  }

  /** Value of one item at `now` — importance × recency × correctness. */
  valueOf(item: MemoryItem, now = this.clock.now()): number {
    return memoryValue({
      importance: item.importance ?? 0.5,
      correctness: item.correctness ?? 0.5,
      lastHitAt: item.lastHitAt,
      createdAt: item.createdAt,
      ttl: item.ttl,
      now,
      halfLifeMs: this.halfLifeMs,
    } satisfies MemoryValueInput);
  }

  /**
   * Write a memory with lifecycle defaults, then trim the budget.
   *
   * Layer derives from kind/scope when not given: procedural kind → procedural
   * layer; global scope → long-term; session scope → short-term. Items that
   * cannot be re-fetched (lessons, preferences, procedural recipes) default to
   * `retrievable = false` so they are never mechanically evicted.
   */
  async remember(input: MemoryWriteInput): Promise<MemoryItem> {
    const now = this.clock.now();
    const layer =
      input.layer ?? (input.kind === 'procedural' ? 'procedural' : input.scope === 'global' ? 'long' : 'short');
    const retrievable =
      input.retrievable ?? !(input.kind === 'lesson' || input.kind === 'preference' || input.kind === 'procedural');
    const item: MemoryItem = {
      id: newId(),
      scope: input.scope,
      sessionId: input.sessionId,
      kind: input.kind,
      content: input.content,
      keywords: input.keywords,
      importance: input.importance ?? 0.5,
      strength: 0.5,
      lastHitAt: now,
      ttl: input.ttl ?? null,
      hits: 0,
      nextReviewAt: nextReviewAt(now, 0),
      retrievable,
      correctness: input.correctness ?? 0.5,
      layer,
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
    };
    await this.store.writeMemory(item);
    const contentSnippet = item.content.replace(/\s+/g, ' ').trim().slice(0, 120);
    this.bus.emit('memory.written', { count: 1, kind: item.kind, contentSnippet }, this.meta);
    this.metrics?.inc('memory.written', { layer });
    await this.evictIfOverBudget();
    return item;
  }

  /** Read one memory back (used by outcome feedback loops). */
  async get(id: Id): Promise<MemoryItem | undefined> {
    return this.store.getMemory(id);
  }

  /**
   * Recall memories matching a query, update their lifecycle (hits, lastHitAt,
   * strength, next spaced review) and measure recall noise.
   *
   * `noise` is the fraction of returned items that share no keyword with the
   * query — a bounded proxy for the "memory pollution" risk: a polluted store
   * returns a high-noise recall, which the metric makes visible.
   *
   * Items marked known-bad (`correctness === 0`, Iteration 21 downgrades) are
   * excluded: a disproved memory must not keep being injected into decisions.
   *
   * MemHarness-style critique: after retrieval, each candidate is scored for
   * applicability to the current session. Cross-session memories are discounted
   * (they may not apply under the current state), and the discounted order is
   * emitted so the caller can prefer same-session, still-valid experience.
   */
  async recall(query: MemoryQuery): Promise<MemoryItem[]> {
    const candidates = await this.store.searchMemories(query);
    const now = this.clock.now();
    const currentSessionId = query.sessionId;
    const critiqued = candidates
      .filter((item) => (item.correctness ?? 0.5) !== 0)
      .map((item) => {
        // Cross-session discount: a memory formed in a different session may
        // not apply to the current state (MemHarness's "source state mismatch").
        const crossSession = currentSessionId != null && item.sessionId != null && item.sessionId !== currentSessionId;
        const applicability = crossSession ? 0.7 : 1.0;
        return { item, crossSession, applicability };
      });
    // Sort by discounted value so the caller injects the most applicable first.
    critiqued.sort((a, b) => b.applicability - a.applicability);
    const items = critiqued.map((c) => c.item);
    for (const item of items) {
      const hits = (item.hits ?? 0) + 1;
      await this.store.updateMemory(item.id, {
        hits,
        lastHitAt: now,
        strength: this.valueOf(item, now),
        nextReviewAt: nextReviewAt(now, hits),
      });
    }
    const noise = this.recallNoise(query.text ?? '', items);
    this.metrics?.observe('memory.recall_noise', noise);
    const queryTokens = tokens(query.text ?? '');
    const provenance = items.map((item) => {
      const itemTokens = tokens(`${item.content} ${item.keywords}`);
      const matchedBy = [...queryTokens].find((token) => itemTokens.has(token)) ?? '';
      return { memoryId: item.id, layer: item.layer ?? item.scope, matchedBy };
    });
    this.bus.emit(
      'memory.recalled',
      { count: items.length, ids: items.map((item) => item.id), noise, provenance },
      this.meta,
    );
    const discountedCount = critiqued.filter((c) => c.crossSession).length;
    if (discountedCount > 0) {
      this.bus.emit(
        'memory.critiqued',
        { discounted: discountedCount, kept: items.length - discountedCount },
        this.meta,
      );
    }
    return items;
  }

  /**
   * Mark a memory as validated by an outcome (correctness → 1, evidence kept).
   *
   * The evidence records *which* verification closed the loop (taskId + verdict,
   * Iteration 22): it is the audit trail behind the correctness boost and is
   * surfaced by the memory panel. Used when a memory-informed decision
   * demonstrably succeeded. When called without evidence, any existing evidence
   * is preserved and none is fabricated.
   */
  async markCorrect(id: Id, evidence?: MemoryEvidence): Promise<void> {
    const item = await this.store.getMemory(id);
    if (!item) return;
    const now = this.clock.now();
    const patch: MemoryPatch = {
      correctness: 1,
      strength: this.valueOf({ ...item, correctness: 1 }, now),
    };
    if (evidence) patch.evidence = evidence;
    else if (item.evidence) patch.evidence = item.evidence;
    await this.store.updateMemory(id, patch);
    this.logger?.debug('memory validated', {
      memoryId: id,
      evidence: evidence ? { taskId: evidence.taskId, verdict: evidence.verdict, at: evidence.at } : null,
    });
  }

  /**
   * Mark a memory as disproved by an outcome (correctness → 0, strength → 0).
   *
   * The correction channel for memory pollution: a memory-informed decision
   * failed, so the item stops being recalled (correctness 0 is excluded from
   * recall and reactivation) while staying in the store as an auditable
   * negative fact. The downgrade is observable via `memory.downgraded`.
   */
  async markIncorrect(id: Id, reason: string): Promise<void> {
    const item = await this.store.getMemory(id);
    if (!item) return;
    await this.store.updateMemory(id, { correctness: 0, strength: 0 });
    this.bus.emit('memory.downgraded', { memoryId: id, reason, correctness: 0 }, this.meta);
    this.metrics?.inc('memory.downgraded', { reason });
    this.logger?.info('memory downgraded', { memoryId: id, reason });
  }

  /**
   * High-value memories due for reactivation (spaced-repetition heuristic).
   *
   * An item is due when its scheduled `nextReviewAt` has passed, or when it is
   * high-importance but has not been used for more than a half-life. Results are
   * ordered by current value so the caller injects the most useful ones first.
   */
  async reactivationDue(limit = 3): Promise<MemoryItem[]> {
    const now = this.clock.now();
    const all = await this.store.listAllMemories();
    const halfLife = this.halfLifeMs;
    const due = all.filter((item) => {
      if ((item.correctness ?? 0.5) === 0) return false; // known-bad items stay out of rotation
      const importance = item.importance ?? 0.5;
      if (item.nextReviewAt !== null && item.nextReviewAt !== undefined && item.nextReviewAt <= now) return true;
      const lastHit = item.lastHitAt ?? item.createdAt;
      const age = Math.max(0, now - lastHit);
      return importance >= 0.7 && age > halfLife;
    });
    due.sort((a, b) => this.valueOf(b, now) - this.valueOf(a, now));
    const picked = due.slice(0, limit);
    for (const item of picked) {
      const next = nextReviewAt(now, (item.hits ?? 0) + 1);
      await this.store.updateMemory(item.id, { nextReviewAt: next });
      this.bus.emit('memory.reactivated', { memoryId: item.id, nextReviewAt: next }, this.meta);
    }
    return picked;
  }

  /**
   * Evict the lowest-value *retrievable* items when the store exceeds budget.
   *
   * Never evicts `retrievable = false` items (lessons, constraints, project
   * facts). Every eviction is logged to the forget trail and emitted, so
   * forgetting is fully auditable.
   */
  async evictIfOverBudget(): Promise<ForgetLogEntry[]> {
    const all = await this.store.listAllMemories();
    if (all.length <= this.budget) return [];
    const now = this.clock.now();
    const evictable = all
      .filter((item) => item.retrievable !== false)
      .sort((a, b) => this.valueOf(a, now) - this.valueOf(b, now));
    const toEvict = evictable.slice(0, all.length - this.budget);
    const entries: ForgetLogEntry[] = [];
    for (const item of toEvict) {
      entries.push(await this.forget(item.id, 'budget-eviction'));
    }
    return entries;
  }

  /**
   * Forget one memory explicitly: hard-delete + audit trail + event.
   *
   * Also used by the mechanical eviction path — this is the single place a
   * forgetting decision is made durable, so nothing is forgotten silently.
   */
  async forget(id: Id, reason: string): Promise<ForgetLogEntry> {
    const item = await this.store.getMemory(id);
    const value = item ? this.valueOf(item) : 0;
    const entry: ForgetLogEntry = {
      id: newId(),
      memoryId: id,
      contentSnippet: (item?.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 120),
      reason,
      value,
      createdAt: this.clock.now(),
    };
    await this.store.deleteMemory(id);
    await this.store.appendForgetLog(entry);
    this.bus.emit(
      'memory.forgotten',
      { memoryId: id, contentSnippet: entry.contentSnippet, reason, value },
      this.meta,
    );
    this.metrics?.inc('memory.forgotten', { reason });
    this.logger?.info('memory forgotten', { memoryId: id, reason, value });
    return entry;
  }

  /**
   * Session-lifecycle promotion (Iteration 21).
   *
   * At task/session end, short-term memories that proved important are promoted
   * to the long-term layer and re-scoped to `global` so they survive across
   * sessions; low-importance session memories stay session-scoped (visible to
   * their own session only). Working memory is not stored at all — it is the
   * per-task `<remembered-context>` injection, released when the task ends.
   *
   * The threshold is a harness config knob (`promoteShortTermThreshold`,
   * default 0.6 — Iteration 22): raising it promotes fewer memories, lowering
   * it keeps more of them across sessions. Each promotion is observable via
   * `memory.promoted`.
   */
  async promoteShortTerm(threshold = 0.6): Promise<MemoryItem[]> {
    const all = await this.store.listAllMemories();
    const promoted: MemoryItem[] = [];
    for (const item of all) {
      if (item.layer !== 'short') continue;
      if ((item.importance ?? 0.5) < threshold) continue;
      // Known-bad items (correctness === 0, marked disproved by an outcome)
      // must never promote to long-term — they are actively wrong.
      if ((item.correctness ?? 0.5) === 0) continue;
      await this.store.updateMemory(item.id, { layer: 'long', scope: 'global' });
      this.bus.emit(
        'memory.promoted',
        { memoryId: item.id, layer: 'long', reason: 'session-lifecycle' },
        this.meta,
      );
      promoted.push({ ...item, layer: 'long', scope: 'global' });
    }
    if (promoted.length > 0) {
      this.logger?.info('short-term memories promoted to long-term', {
        count: promoted.length,
        ids: promoted.map((item) => item.id),
      });
    }
    return promoted;
  }

  /**
   * Promote one specific short-term memory to long-term (Iteration 22 — the
   * memory panel's user action). The user decides a session memory is worth
   * keeping across sessions even if it never crossed the automatic threshold.
   */
  async promoteMemory(id: Id): Promise<MemoryItem | undefined> {
    const item = await this.store.getMemory(id);
    if (!item) return undefined;
    if (item.layer === 'short') {
      await this.store.updateMemory(item.id, { layer: 'long', scope: 'global' });
      this.bus.emit('memory.promoted', { memoryId: item.id, layer: 'long', reason: 'user-promotion' }, this.meta);
      this.logger?.info('memory promoted by user', { memoryId: id });
    }
    return { ...item, layer: 'long', scope: 'global' };
  }

  /**
   * Describe one memory for the panel (Iteration 22): the current value and the
   * recency component, so the UI can show `importance × recency × correctness`
   * as a decomposition rather than an opaque score.
   */
  describe(item: MemoryItem, now = this.clock.now()): { strength: number; recency: number } {
    const reference = item.lastHitAt ?? item.createdAt;
    const recency = recencyScore(reference, now, halfLifeOf({ ttl: item.ttl, halfLifeMs: this.halfLifeMs }));
    return { strength: this.valueOf(item, now), recency };
  }

  /** List memories, optionally restricted to one layer (memory panel query). */
  async listByLayer(layer?: MemoryLayer): Promise<MemoryItem[]> {
    if (layer) return this.store.searchMemories({ layer, limit: 5_000 });
    return this.store.listAllMemories(5_000);
  }

  /**
   * Cross-session recall-noise aggregate (Iteration 22).
   *
   * Reads the persisted event log and folds `memory.recalled` + `memory.downgraded`
   * into the pollution-rate 口径 defined in `recallNoise.ts`. The result is also
   * recorded as a metric sample so health is queryable, not just visible.
   */
  async recallNoiseAggregate(sessionId?: Id): Promise<RecallNoiseAggregate> {
    const events = await this.store.listEvents(
      sessionId ? { sessionId, limit: 5_000 } : { limit: 5_000 },
    );
    const aggregate = computeRecallNoiseAggregate(events);
    this.metrics?.observe('memory.recall_noise_rate', aggregate.noiseRate);
    return aggregate;
  }

  /**
   * Recall timeline (Iteration 26 — the panel's visible recall history).
   *
   * Reads the persisted event log and folds `memory.recalled` + `memory.downgraded`
   * into per-hit records with the same 口径 as {@link recallNoiseAggregate}. The
   * service only does I/O (load events, load the mentioned memories' content once)
   * — the fold itself is the pure `buildRecallTimeline` function.
   */
  async recallTimeline(query: RecallTimelineQuery = {}): Promise<RecallTimelineHit[]> {
    const events = await this.store.listEvents(
      query.sessionId ? { sessionId: query.sessionId, limit: 5_000 } : { limit: 5_000 },
    );
    const ids = new Set<string>();
    for (const event of events) {
      if (event.type !== 'memory.recalled') continue;
      const payload = event.payload as { ids?: unknown };
      if (!Array.isArray(payload?.ids)) continue;
      for (const id of payload.ids) if (typeof id === 'string') ids.add(id);
    }
    const contentById = new Map<string, string>();
    for (const memoryId of ids) {
      const item = await this.store.getMemory(memoryId);
      if (item) contentById.set(memoryId, item.content);
    }
    return buildRecallTimeline(events, { ...query, contentById });
  }

  /**
   * Recall-noise metric: 1 − (relevant / total), where relevant means at least
   * one query keyword overlaps the item's content or keywords. 0 = clean recall.
   */
  recallNoise(queryText: string, items: MemoryItem[]): number {
    if (items.length === 0 || queryText.trim() === '') return 0;
    const queryTokens = tokens(queryText);
    const relevant = items.filter((item) => {
      const itemTokens = tokens(`${item.content} ${item.keywords}`);
      for (const token of queryTokens) {
        if (itemTokens.has(token)) return true;
      }
      return false;
    }).length;
    return 1 - relevant / items.length;
  }
}

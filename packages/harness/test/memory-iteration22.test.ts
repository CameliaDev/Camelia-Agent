/**
 * Memory panel mechanics — visible · usable · tunable (Iteration 22).
 *
 * The Iteration 21 closed loop (recall → outcome → reinforce/downgrade) is now
 * user-visible and user-tunable. These tests pin:
 *
 *  - the `promoteShortTerm` threshold knob (0.59 no / 0.60 yes / explicit override),
 *  - the one-memory `promoteMemory` panel action,
 *  - evidence-backed `markCorrect` (taskId + verdict recorded, entering the value
 *    formula via correctness = 1),
 *  - the cross-session recall-noise aggregate口径 (`downgradedHits / totalHits`).
 * @module
 */

import { describe, expect, it } from 'vitest';

import type { MemoryItem, StoredEvent } from '@camelia/core';

import { MemoryService } from '../src/memory/MemoryService.js';
import { computeRecallNoiseAggregate } from '../src/memory/recallNoise.js';
import { memoryValue } from '../src/memory/value.js';
import { resolveConfig } from '../src/index.js';
import { makeHarness } from './helpers/context.js';

function makeService(budget = 5, halfLifeMs = 1_000) {
  const h = makeHarness();
  const service = new MemoryService({
    store: h.store,
    bus: h.bus,
    logger: h.logger,
    metrics: h.metrics,
    clock: h.clock,
    budget,
    halfLifeMs,
    meta: { traceId: 'tr', sessionId: h.ctx.sessionId, taskId: h.ctx.taskId },
  });
  return { h, service };
}

// ---------------------------------------------------------------------------
// C — promoteShortTerm threshold is a config knob
// ---------------------------------------------------------------------------

describe('promoteShortTerm threshold (Iteration 22)', () => {
  it('default config is 0.6 — exactly the Iteration 21 behaviour', () => {
    expect(resolveConfig({}).promoteShortTermThreshold).toBe(0.6);
    expect(resolveConfig({ promoteShortTermThreshold: 0.4 }).promoteShortTermThreshold).toBe(0.4);
  });

  it('0.59 does not promote; 0.60 does — the boundary is inclusive', async () => {
    const { h, service } = makeService();
    const below = await service.remember({
      scope: 'session', sessionId: h.ctx.sessionId, kind: 'fact',
      content: 'just under the wire', keywords: 'wire', importance: 0.59,
    });
    const at = await service.remember({
      scope: 'session', sessionId: h.ctx.sessionId, kind: 'fact',
      content: 'right on the line', keywords: 'line', importance: 0.6,
    });

    const promoted = await service.promoteShortTerm(0.6);
    expect(promoted.map((m) => m.id)).not.toContain(below.id);
    expect(promoted.map((m) => m.id)).toContain(at.id);
    expect(h.store.memories.find((m) => m.id === below.id)?.layer).toBe('short');
    expect(h.store.memories.find((m) => m.id === at.id)?.layer).toBe('long');
  });

  it('an explicit override moves the decision line', async () => {
    const { h, service } = makeService();
    const mid = await service.remember({
      scope: 'session', sessionId: h.ctx.sessionId, kind: 'fact',
      content: 'medium importance', keywords: 'medium', importance: 0.5,
    });
    await service.promoteShortTerm(0.4); // user tuned the knob down
    expect(h.store.memories.find((m) => m.id === mid.id)?.layer).toBe('long');
    expect(h.store.memories.find((m) => m.id === mid.id)?.scope).toBe('global');
  });

  it('each automatic promotion is observable via memory.promoted (session-lifecycle)', async () => {
    const { h, service } = makeService();
    await service.remember({
      scope: 'session', sessionId: h.ctx.sessionId, kind: 'fact',
      content: 'a survivor', keywords: 'survivor', importance: 0.9,
    });
    await service.promoteShortTerm(0.6);
    const promoted = h.events.find((e) => e.type === 'memory.promoted');
    expect(promoted).toBeTruthy();
    expect((promoted!.payload as { reason: string }).reason).toBe('session-lifecycle');
    expect((promoted!.payload as { layer: string }).layer).toBe('long');
  });
});

// ---------------------------------------------------------------------------
// B — promoteMemory: the one-memory panel action
// ---------------------------------------------------------------------------

describe('promoteMemory (Iteration 22)', () => {
  it('promotes one short-term memory to long-term/global and emits memory.promoted', async () => {
    const { h, service } = makeService();
    const target = await service.remember({
      scope: 'session', sessionId: h.ctx.sessionId, kind: 'fact',
      content: 'user wants this kept', keywords: 'keep', importance: 0.2,
    });
    const upgraded = await service.promoteMemory(target.id);
    expect(upgraded?.layer).toBe('long');
    expect(upgraded?.scope).toBe('global');
    const stored = h.store.memories.find((m) => m.id === target.id)!;
    expect(stored.layer).toBe('long');
    expect(stored.scope).toBe('global');
    const promoted = h.events.find((e) => e.type === 'memory.promoted');
    expect(promoted).toBeTruthy();
    expect((promoted!.payload as { memoryId: string }).memoryId).toBe(target.id);
    expect((promoted!.payload as { reason: string }).reason).toBe('user-promotion');
  });

  it('is a no-op for a memory that is already long-term — no duplicate event', async () => {
    const { h, service } = makeService();
    const target = await service.remember({
      scope: 'global', kind: 'fact', content: 'already long', keywords: 'long', layer: 'long',
    });
    await service.promoteMemory(target.id);
    const promoted = h.events.filter((e) => e.type === 'memory.promoted');
    expect(promoted.length).toBe(0);
  });

  it('returns undefined for a missing memory — the panel turns that into an honest error', async () => {
    const { service } = makeService();
    expect(await service.promoteMemory('mem_nope')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// C — markCorrect records its evidence; the evidence enters the value formula
// ---------------------------------------------------------------------------

describe('markCorrect evidence (Iteration 22)', () => {
  it('records which task verification passed (taskId + verdict) and persists it', async () => {
    const { h, service } = makeService();
    const recipe = await service.remember({
      scope: 'global', kind: 'procedural',
      content: 'when asked to scaffold a module, run pnpm create and tsc', keywords: 'scaffold module',
      importance: 0.6, retrievable: false, correctness: 0.5,
    });
    await service.markCorrect(recipe.id, { taskId: 'tsk_verify_42', verdict: 'pass', at: h.clock.now() });

    const stored = h.store.memories.find((m) => m.id === recipe.id)!;
    expect(stored.correctness).toBe(1);
    expect(stored.evidence).toEqual({ taskId: 'tsk_verify_42', verdict: 'pass', at: h.clock.now() });

    // The evidence is retrievable through the read path the panel uses.
    const viaGet = await service.get(recipe.id);
    expect(viaGet?.evidence?.taskId).toBe('tsk_verify_42');
  });

  it('evidence enters the value formula: strength is value with correctness 1, backed by evidence', async () => {
    const { h, service } = makeService();
    const recipe = await service.remember({
      scope: 'global', kind: 'procedural',
      content: 'recipe that just passed verification', keywords: 'recipe',
      importance: 0.6, correctness: 0.5,
    });
    // Freshly written memories start at neutral strength 0.5 (lastHitAt = now).
    // Capture before markCorrect: the in-memory store mutates the same object.
    const initialStrength = recipe.strength;
    expect(initialStrength).toBe(0.5);

    await service.markCorrect(recipe.id, { taskId: 'tsk_verify_43', verdict: 'pass', at: h.clock.now() });

    const stored = h.store.memories.find((m) => m.id === recipe.id)!;
    const expected = memoryValue({
      importance: stored.importance ?? 0.5,
      correctness: 1, // the evidence-backed boost — this is what enters the formula
      createdAt: stored.createdAt,
      lastHitAt: stored.lastHitAt,
      ttl: stored.ttl,
      now: h.clock.now(),
      halfLifeMs: 1_000,
    });
    expect(stored.strength).toBeCloseTo(expected, 10);
    expect(stored.strength).toBeGreaterThan(initialStrength ?? 0); // validated > unvalidated
  });

  it('markCorrect without evidence keeps the item honest — no fabricated trail', async () => {
    const { h, service } = makeService();
    const m = await service.remember({
      scope: 'global', kind: 'fact', content: 'a fact', keywords: 'fact', correctness: 0.4,
    });
    await service.markCorrect(m.id);
    const stored = h.store.memories.find((x) => x.id === m.id)!;
    expect(stored.correctness).toBe(1);
    expect(stored.evidence).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// C — cross-session recall-noise aggregate (pollution rate)
// ---------------------------------------------------------------------------

/** Seed persisted events as the engine would have stored them. */
function seedRecallEvents(h: ReturnType<typeof makeHarness>, events: StoredEvent[]): void {
  h.store.events.push(...events);
}

describe('recall_noise aggregate (Iteration 22)', () => {
  it('pins the 口径: downgradedHits / totalHits over the persisted log', () => {
    const aggregate = computeRecallNoiseAggregate([
      { type: 'memory.recalled', payload: { count: 3, ids: ['a', 'b', 'c'], noise: 0 } },
      { type: 'memory.recalled', payload: { count: 2, ids: ['d', 'e'], noise: 0 } },
      { type: 'memory.downgraded', payload: { memoryId: 'b', reason: 'user-correction', correctness: 0 } },
      { type: 'memory.downgraded', payload: { memoryId: 'e', reason: 'task-verification-gap', correctness: 0 } },
      { type: 'task.completed', payload: { taskId: 't1' } }, // ignored
    ]);
    // totalHits = 3 + 2 = 5; downgradedHits = b + e = 2; rate = 2/5 = 0.4
    expect(aggregate.totalHits).toBe(5);
    expect(aggregate.downgradedHits).toBe(2);
    expect(aggregate.downgradedMemories).toBe(2);
    expect(aggregate.noiseRate).toBeCloseTo(0.4, 10);
  });

  it('is 0 when there were no hits — a clean store cannot have noise', () => {
    const aggregate = computeRecallNoiseAggregate([
      { type: 'memory.downgraded', payload: { memoryId: 'a', reason: 'x', correctness: 0 } },
    ]);
    expect(aggregate.noiseRate).toBe(0);
    expect(aggregate.totalHits).toBe(0);
  });

  it('counts a downgraded memory once per recall event that served it', () => {
    const aggregate = computeRecallNoiseAggregate([
      { type: 'memory.recalled', payload: { count: 2, ids: ['a', 'a'], noise: 0 } },
      { type: 'memory.downgraded', payload: { memoryId: 'a', reason: 'x', correctness: 0 } },
    ]);
    expect(aggregate.downgradedHits).toBe(2); // a was served twice before being disproved
    expect(aggregate.noiseRate).toBe(1);
  });

  it('MemoryService.recallNoiseAggregate reads the persisted log and records the metric sample', async () => {
    const { h, service } = makeService();
    seedRecallEvents(h, [
      { type: 'memory.recalled', payload: { count: 4, ids: ['m1', 'm2', 'm3', 'm4'], noise: 0 }, ts: 1, traceId: 'tr', sessionId: h.ctx.sessionId, seq: 1 },
      { type: 'memory.downgraded', payload: { memoryId: 'm2', reason: 'user-correction', correctness: 0 }, ts: 2, traceId: 'tr', sessionId: h.ctx.sessionId, seq: 2 },
    ] as unknown as StoredEvent[]);

    const aggregate = await service.recallNoiseAggregate(h.ctx.sessionId);
    expect(aggregate.totalHits).toBe(4);
    expect(aggregate.downgradedHits).toBe(1);
    expect(aggregate.noiseRate).toBeCloseTo(0.25, 10);

    // "落 metrics": the aggregate is observable as a metric sample, not just internal.
    const sample = h.metrics.snapshot().find((m) => m.name === 'memory.recall_noise_rate');
    expect(sample).toBeTruthy();
    expect(sample!.value).toBeCloseTo(0.25, 10);
  });
});

// ---------------------------------------------------------------------------
// A — the panel's read surface: listByLayer + describe
// ---------------------------------------------------------------------------

describe('MemoryService panel surface (Iteration 22)', () => {
  it('lists memories by layer and describes the value decomposition', async () => {
    const { h, service } = makeService();
    const long = await service.remember({
      scope: 'global', kind: 'fact', content: 'a long fact', keywords: 'long fact', importance: 0.8, layer: 'long',
    });
    await service.remember({
      scope: 'session', sessionId: h.ctx.sessionId, kind: 'fact', content: 'a short fact', keywords: 'short fact',
    });

    const longs = await service.listByLayer('long');
    expect(longs.map((m) => m.id)).toEqual([long.id]);

    const described = service.describe(long, h.clock.now());
    expect(described.strength).toBeGreaterThan(0);
    expect(described.recency).toBeGreaterThan(0);
    // The decomposition is exact: strength === importance × recency × correctness.
    expect(described.strength).toBeCloseTo(
      (long.importance ?? 0.5) * described.recency * (long.correctness ?? 0.5),
      10,
    );
  });
});

// ---------------------------------------------------------------------------
// shared fixture for the tests above
// ---------------------------------------------------------------------------

export function panelItem(overrides: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id: overrides.id ?? 'panel-mem',
    scope: 'global',
    kind: 'fact',
    content: overrides.content ?? 'the staging key lives in the vault',
    keywords: overrides.keywords ?? 'vault staging',
    importance: 0.9,
    correctness: 0.5,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

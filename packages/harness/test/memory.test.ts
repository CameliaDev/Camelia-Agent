/**
 * Memory lifecycle & value-driven forgetting (Iteration 20).
 *
 * Unit + integration tests for the value score and the MemoryService: four-layer
 * memory, budget eviction (retrievable-only), spaced-repetition reactivation,
 * forget audit trail and the recall-noise metric that bounds memory pollution.
 * @module
 */

import { describe, expect, it } from 'vitest';

import type { MemoryItem } from '@camelia/core';

import { MemoryService } from '../src/memory/MemoryService.js';
import { memoryValue, nextReviewAt, tokens } from '../src/memory/value.js';
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

function item(overrides: Partial<MemoryItem>): MemoryItem {
  return {
    id: overrides.id ?? 'm',
    scope: 'global',
    kind: 'fact',
    content: overrides.content ?? 'project uses pnpm workspace',
    keywords: overrides.keywords ?? 'pnpm workspace',
    importance: 0.5,
    correctness: 0.5,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// value score
// ---------------------------------------------------------------------------

describe('memoryValue', () => {
  it('is importance × recency × correctness — a fresh high-value hit scores high', () => {
    const fresh = memoryValue({ importance: 1, correctness: 1, createdAt: 0, lastHitAt: 0, now: 0, halfLifeMs: 1000 });
    expect(fresh).toBeCloseTo(1);
  });

  it('decays with time since the last hit, but importance keeps it alive', () => {
    const now = 100_000;
    const halfLifeMs = 1_000;
    const old = memoryValue({ importance: 0.5, correctness: 0.5, createdAt: 0, lastHitAt: 0, now, halfLifeMs });
    // age = 100 half-lives → recency ≈ 0.01
    expect(old).toBeCloseTo(0.5 * 0.5 * (1 / (1 + 100)), 5);
    const precious = memoryValue({ importance: 1, correctness: 1, createdAt: 0, lastHitAt: 0, now, halfLifeMs });
    expect(precious).toBeGreaterThan(old);
  });

  it('a memory validated correct out-scores one that was not', () => {
    const now = 1_000;
    const validated = memoryValue({ importance: 0.8, correctness: 1, lastHitAt: now - 500, createdAt: 0, now, halfLifeMs: 1000 });
    const unvalidated = memoryValue({ importance: 0.8, correctness: 0.1, lastHitAt: now - 500, createdAt: 0, now, halfLifeMs: 1000 });
    expect(validated).toBeGreaterThan(unvalidated);
  });

  it('uses createdAt as the recency anchor when never hit', () => {
    const fresh = memoryValue({ importance: 0.5, correctness: 0.5, createdAt: 0, now: 0, halfLifeMs: 1000 });
    const stale = memoryValue({ importance: 0.5, correctness: 0.5, createdAt: 0, now: 10_000, halfLifeMs: 1000 });
    expect(fresh).toBeGreaterThan(stale);
  });
});

// ---------------------------------------------------------------------------
// service
// ---------------------------------------------------------------------------

describe('MemoryService — remember & layers', () => {
  it('writes a memory with lifecycle defaults and derives the layer', async () => {
    const { h, service } = makeService();
    await service.remember({
      scope: 'session', sessionId: h.ctx.sessionId, kind: 'fact',
      content: 'the fixture port is 5173', keywords: 'fixture port',
    });
    const stored = h.store.memories[0]!;
    expect(stored.layer).toBe('short');
    expect(stored.strength).toBe(0.5);
    expect(stored.importance).toBe(0.5);
    expect(stored.hits).toBe(0);
    expect(stored.retrievable).toBe(true);
  });

  it('maps lessons/preferences/procedural to non-evictable, procedural to its own layer', async () => {
    const { h, service } = makeService();
    await service.remember({
      scope: 'global', kind: 'lesson', content: 'never trust a green test without running it', keywords: 'lesson',
    });
    await service.remember({
      scope: 'global', kind: 'procedural', content: 'when X then Y', keywords: 'recipe',
    });
    const byKind = (kind: string) => h.store.memories.find((m) => m.kind === kind)!;
    expect(byKind('lesson').retrievable).toBe(false);
    expect(byKind('procedural').retrievable).toBe(false);
    expect(byKind('procedural').layer).toBe('procedural');
  });
});

describe('MemoryService — recall & pollution metric', () => {
  it('recalls relevant items only, updates lifecycle and emits a noise-tagged event with provenance', async () => {
    const { h, service } = makeService();
    const pnpm = await service.remember({
      scope: 'global', kind: 'fact', content: 'the build command is pnpm build', keywords: 'pnpm build',
    });
    await service.remember({
      scope: 'global', kind: 'fact', content: 'the moon is made of cheese', keywords: 'moon cheese',
    });

    const hits = await service.recall({ text: 'build command', limit: 5 });
    // Token-based retrieval keeps only the relevant item — the cheese fact is
    // not recalled, so recall noise for this query is 0.
    expect(hits.map((m) => m.id)).toEqual([pnpm.id]);
    const relevant = hits[0]!;
    expect(relevant.hits).toBe(1);
    expect(relevant.lastHitAt).toBe(h.clock.now());
    expect(relevant.strength).toBeGreaterThan(0);

    const recalled = h.events.find((e) => e.type === 'memory.recalled');
    expect(recalled).toBeTruthy();
    const payload = recalled!.payload as { noise: number; provenance: { memoryId: string; layer: string; matchedBy: string }[] };
    expect(payload.noise).toBe(0);
    expect(payload.provenance).toEqual([
      { memoryId: pnpm.id, layer: 'long', matchedBy: 'build' },
    ]);
  });

  it('recallNoise is 0 for a clean recall and 1 for a fully irrelevant one', async () => {
    const { service } = makeService();
    const relevant = [item({ content: 'run pnpm build before pushing', keywords: 'pnpm build' })];
    const irrelevant = [item({ content: 'the zebra migration schedule', keywords: 'zebra' })];
    expect(service.recallNoise('build the project with pnpm', relevant)).toBe(0);
    expect(service.recallNoise('build the project with pnpm', irrelevant)).toBe(1);
    expect(service.recallNoise('', relevant)).toBe(0);
    expect(service.recallNoise('anything', [])).toBe(0);
  });

  it('tokenises only meaningful words for overlap checks', () => {
    expect(tokens('run pnpm build now')).toEqual(new Set(['run', 'pnpm', 'build', 'now']));
  });

  it('never recalls a downgraded (correctness 0) memory — the correction channel', async () => {
    const { h, service } = makeService();
    const recipe = await service.remember({
      scope: 'global', kind: 'procedural',
      content: 'when asked to scaffold a module, run pnpm create and tsc', keywords: 'scaffold module',
      importance: 0.6, retrievable: false, correctness: 0.5,
    });
    await service.markIncorrect(recipe.id, 'task-verification-gap');

    const downgraded = h.events.find((e) => e.type === 'memory.downgraded');
    expect(downgraded).toBeTruthy();
    expect((downgraded!.payload as { reason: string }).reason).toBe('task-verification-gap');
    expect(h.store.memories.find((m) => m.id === recipe.id)?.correctness).toBe(0);

    // A disproved recipe must not keep being injected into later decisions.
    const hits = await service.recall({ text: 'scaffold a module', limit: 5 });
    expect(hits.map((m) => m.id)).not.toContain(recipe.id);
    // ... nor scheduled for reactivation.
    const due = await service.reactivationDue(5);
    expect(due.map((m) => m.id)).not.toContain(recipe.id);
    // ... but it is still stored, as an auditable negative fact.
    expect(await service.get(recipe.id)).toBeTruthy();
  });
});

describe('MemoryService — value-driven eviction', () => {
  it('evicts the lowest-value retrievable items over budget and audits the trail', async () => {
    const { h, service } = makeService(2);
    for (let i = 0; i < 4; i += 1) {
      await service.remember({
        scope: 'global', kind: 'fact',
        content: `syntax detail number ${i}`, keywords: `syntax ${i}`,
        importance: 0.1 + i * 0.2,
      });
    }
    expect(h.store.memories.length).toBe(2);
    expect(h.store.forgetLog.length).toBe(2);
    const forgotten = h.events.filter((e) => e.type === 'memory.forgotten');
    expect(forgotten.length).toBe(2);
    for (const entry of forgotten) {
      expect((entry.payload as { reason: string }).reason).toBe('budget-eviction');
      expect((entry.payload as { contentSnippet: string }).contentSnippet).toContain('syntax detail');
    }
    // The two survivors are the highest-value items.
    const survivors = h.store.memories.map((m) => m.content).join('|');
    expect(survivors).toContain('syntax detail number 3');
  });

  it('never mechanically evicts non-retrievable lessons', async () => {
    const { h, service } = makeService(1);
    await service.remember({
      scope: 'global', kind: 'lesson', content: 'rollback before trusting a refactor', keywords: 'rollback',
    });
    for (let i = 0; i < 3; i += 1) {
      await service.remember({
        scope: 'global', kind: 'fact', content: `retrievable fact ${i}`, keywords: `fact ${i}`,
      });
    }
    // Only retrievable facts were trimmed; the lesson survives untouched.
    expect(h.store.memories.some((m) => m.kind === 'lesson')).toBe(true);
    expect(h.store.forgetLog.every((e) => e.reason === 'budget-eviction')).toBe(true);
  });
});

describe('MemoryService — reactivation & explicit forgetting', () => {
  it('schedules high-value long-unused memories for reactivation (spaced-repetition)', async () => {
    const { h, service } = makeService();
    h.clock.advance(100_000);
    const precious = await service.remember({
      scope: 'global', kind: 'fact',
      content: 'the staging key lives in the vault', keywords: 'vault staging',
      importance: 0.9,
    });
    const forgettable = await service.remember({
      scope: 'global', kind: 'fact',
      content: 'some obsolete flag spelling', keywords: 'flag obsolete',
      importance: 0.1,
    });
    h.clock.advance(50_000); // both are old now; only the precious one matters
    const due = await service.reactivationDue(1);
    expect(due.map((m) => m.id)).toContain(precious.id);
    expect(due.map((m) => m.id)).not.toContain(forgettable.id);
    const reactivated = h.events.find((e) => e.type === 'memory.reactivated');
    expect(reactivated).toBeTruthy();
    expect((reactivated!.payload as { memoryId: string }).memoryId).toBe(precious.id);
  });

  it('forget() deletes, writes the audit trail and emits memory.forgotten', async () => {
    const { h, service } = makeService();
    const victim = await service.remember({
      scope: 'session', kind: 'fact', content: 'transient token format details', keywords: 'token format',
    });
    const entry = await service.forget(victim.id, 'manual');
    expect(entry.reason).toBe('manual');
    expect(entry.memoryId).toBe(victim.id);
    expect(entry.contentSnippet).toContain('transient token');
    expect(h.store.memories.find((m) => m.id === victim.id)).toBeUndefined();
    expect(h.store.forgetLog[0]?.reason).toBe('manual');
    expect(h.events.some((e) => e.type === 'memory.forgotten')).toBe(true);
  });

  it('markCorrect raises correctness to 1', async () => {
    const { h, service } = makeService();
    const m = await service.remember({
      scope: 'global', kind: 'fact', content: 'a useful fact', keywords: 'fact', correctness: 0.5,
    });
    await service.markCorrect(m.id);
    expect(h.store.memories.find((x) => x.id === m.id)?.correctness).toBe(1);
  });

  it('nextReviewAt grows with hits — known memories are reviewed rarely', () => {
    const base = 1000;
    expect(nextReviewAt(base, 0)).toBe(base + 24 * 60 * 60 * 1000);
    expect(nextReviewAt(base, 5)).toBe(base + 6 * 24 * 60 * 60 * 1000);
    expect(nextReviewAt(base, 5)).toBeGreaterThan(nextReviewAt(base, 2));
  });
});

describe('MemoryService — session lifecycle promotion (Iteration 21)', () => {
  it('promotes important short-term memories to long-term/global at session end', async () => {
    const { h, service } = makeService();
    const important = await service.remember({
      scope: 'session', sessionId: h.ctx.sessionId, kind: 'fact',
      content: 'the staging API key lives in the vault', keywords: 'staging vault',
      importance: 0.8,
    });
    const trivial = await service.remember({
      scope: 'session', sessionId: h.ctx.sessionId, kind: 'fact',
      content: 'the fixture port for this run was 5173', keywords: 'fixture port',
      importance: 0.3,
    });

    const promoted = await service.promoteShortTerm(0.6);

    expect(promoted.map((m) => m.id)).toContain(important.id);
    const stored = h.store.memories.find((m) => m.id === important.id)!;
    expect(stored.layer).toBe('long');
    expect(stored.scope).toBe('global');
    // Trivial session memories stay session-scoped — invisible to other sessions.
    const trivialStored = h.store.memories.find((m) => m.id === trivial.id)!;
    expect(trivialStored.layer).toBe('short');
    expect(trivialStored.scope).toBe('session');
  });

  it('emits memory.written with a bounded content snippet for the timeline', async () => {
    const { h, service } = makeService();
    await service.remember({
      scope: 'global', kind: 'fact',
      content: 'the workspace convention is src/ for source and test/ for tests', keywords: 'convention',
    });
    const written = h.events.find((e) => e.type === 'memory.written');
    expect(written).toBeTruthy();
    const payload = written!.payload as { count: number; kind: string; contentSnippet: string };
    expect(payload.count).toBe(1);
    expect(payload.kind).toBe('fact');
    expect(payload.contentSnippet).toContain('workspace convention');
  });
});

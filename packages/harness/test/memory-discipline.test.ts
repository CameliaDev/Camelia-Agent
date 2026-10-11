/**
 * Forgetting discipline audit (Iteration 21 — §D).
 *
 * Executable assertions over the value-driven forgetting contract:
 *  1. `retrievable = false` items (lessons / preferences / procedural recipes —
 *     information that cannot be re-fetched) are never mechanically evicted,
 *     even under extreme budget pressure.
 *  2. Every forgetting decision is audited: one forget-log entry per eviction
 *     and manual forget, each carrying memoryId + reason + contentSnippet.
 *  3. The value formula (importance × recency × correctness) and the
 *     spaced-repetition schedule (nextReviewAt grows with hits) match the
 *     design in `memory/value.ts`.
 *  4. recall_noise remains measurable as a bounded pollution proxy.
 *  5. Outcome validation feeds the value formula: markCorrect raises the score,
 *     markIncorrect zeroes it and excludes the item from recall.
 * @module
 */

import { describe, expect, it } from 'vitest';

import type { MemoryItem } from '@camelia/core';

import { MemoryService } from '../src/memory/MemoryService.js';
import { memoryValue, nextReviewAt } from '../src/memory/value.js';
import { makeHarness } from './helpers/context.js';

function makeService(budget = 10, halfLifeMs = 30 * 24 * 60 * 60 * 1000) {
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
    content: overrides.content ?? 'some retrievable fact',
    keywords: overrides.keywords ?? 'fact',
    importance: 0.5,
    correctness: 0.5,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe('forgetting discipline — non-retrievable items are never mechanically evicted', () => {
  it('keeps every lesson/preference/procedural while trimming retrievable facts to budget', async () => {
    const { h, service } = makeService(2);
    const protectedKinds = ['lesson', 'preference', 'procedural'] as const;
    const protectedIds = new Set<string>();
    for (let i = 0; i < 3; i += 1) {
      for (const kind of protectedKinds) {
        const written = await service.remember({
          scope: 'global',
          kind,
          content: `${kind} ${i}: a hard-won, non-re-fetchable insight`,
          keywords: `${kind} ${i}`,
          importance: 0.7,
          retrievable: false,
        });
        protectedIds.add(written.id);
      }
    }
    // A budget of 2 with 9 protected items and then a flood of retrievable facts.
    for (let i = 0; i < 40; i += 1) {
      await service.remember({
        scope: 'global', kind: 'fact', content: `ephemeral syntax detail ${i}`, keywords: `detail ${i}`, importance: 0.1,
      });
    }

    // Protected items may exceed the numeric budget — that is the point: they are
    // never trimmed, so the store holds exactly the 9 protected items and zero facts.
    expect(h.store.memories.length).toBe(9);
    for (const id of protectedIds) {
      expect(h.store.memories.some((m) => m.id === id)).toBe(true);
    }
    expect(h.store.memories.every((m) => protectedIds.has(m.id))).toBe(true);
    // Every eviction was a retrievable fact — never a protected item.
    expect(h.store.forgetLog.every((entry) => entry.contentSnippet.includes('ephemeral syntax detail'))).toBe(true);
    expect(h.store.forgetLog.length).toBe(40);
  });

  it('holds protected items even when the budget is smaller than the protected set', async () => {
    const { h, service } = makeService(1);
    for (let i = 0; i < 4; i += 1) {
      await service.remember({
        scope: 'global', kind: 'lesson', content: `lesson ${i}: irreplaceable constraint`, keywords: `lesson ${i}`, retrievable: false,
      });
    }
    for (let i = 0; i < 5; i += 1) {
      await service.remember({ scope: 'global', kind: 'fact', content: `trivia ${i}`, keywords: `trivia ${i}` });
    }
    // The lesson survives; only trivia was trimmed.
    expect(h.store.memories.some((m) => m.kind === 'lesson')).toBe(true);
    expect(h.store.memories.every((m) => m.kind === 'lesson')).toBe(true);
  });
});

describe('forgetting discipline — every forget is audited', () => {
  it('writes one forget-log entry per eviction and manual forget, with reason and snippet', async () => {
    const { h, service } = makeService(1);
    for (let i = 0; i < 3; i += 1) {
      await service.remember({ scope: 'global', kind: 'fact', content: `volatile detail ${i}`, keywords: `volatile ${i}` });
    }
    // Budget 1: two evictions happened during the loop; one item survives.
    expect(h.store.memories).toHaveLength(1);
    const survivor = h.store.memories[0]!;
    const manual = await service.forget(survivor.id, 'manual-review');

    const log = h.store.forgetLog;
    // 2 budget evictions + 1 manual forget = 3 audited decisions.
    expect(log).toHaveLength(3);
    const reasons = log.map((entry) => entry.reason).sort();
    expect(reasons).toEqual(['budget-eviction', 'budget-eviction', 'manual-review']);
    for (const entry of log) {
      expect(entry.memoryId).toBeTruthy();
      expect(entry.contentSnippet.length).toBeGreaterThan(0);
      expect(entry.reason).toBeTruthy();
    }
    expect(log.some((entry) => entry.reason === 'manual-review' && entry.memoryId === survivor.id)).toBe(true);
    // Events mirror the audit trail 1:1.
    const forgotten = h.events.filter((e) => e.type === 'memory.forgotten');
    expect(forgotten).toHaveLength(3);
    expect(manual.memoryId).toBe(survivor.id);
  });
});

describe('forgetting discipline — value formula and spaced repetition match the design', () => {
  it('value = importance × recency × correctness at sampled points', () => {
    const now = 10_000;
    const halfLifeMs = 1_000;
    const cases = [
      { importance: 1, correctness: 1, lastHitAt: 0, expected: 1 * 1 * (1 / (1 + 10)) },
      { importance: 0.5, correctness: 0.5, lastHitAt: now, expected: 0.5 * 0.5 * 1 },
      { importance: 0.9, correctness: 0, lastHitAt: now, expected: 0 },
    ];
    for (const c of cases) {
      expect(
        memoryValue({ importance: c.importance, correctness: c.correctness, lastHitAt: c.lastHitAt, createdAt: 0, now, halfLifeMs }),
      ).toBeCloseTo(c.expected, 5);
    }
  });

  it('nextReviewAt grows with hit count (spaced repetition: well-known memories are reviewed rarely)', () => {
    const now = 1_000;
    expect(nextReviewAt(now, 0)).toBe(now + 24 * 60 * 60 * 1000);
    expect(nextReviewAt(now, 1)).toBe(now + 2 * 24 * 60 * 60 * 1000);
    expect(nextReviewAt(now, 10)).toBeGreaterThan(nextReviewAt(now, 2));
  });

  it('a validated outcome raises the stored strength; a disproved one zeroes it', async () => {
    const { h, service } = makeService();
    const recipe = await service.remember({
      scope: 'global', kind: 'procedural',
      content: 'when asked to scaffold, run pnpm create and tsc', keywords: 'scaffold',
      importance: 0.6, correctness: 0.5, retrievable: false,
    });
    // The fake store mutates the item in place, so capture the pre-feedback value.
    const beforeStrength = h.store.memories.find((m) => m.id === recipe.id)!.strength!;
    await service.markCorrect(recipe.id);
    const validated = h.store.memories.find((m) => m.id === recipe.id)!;
    expect(validated.correctness).toBe(1);
    expect(validated.strength!).toBeGreaterThan(beforeStrength);

    await service.markIncorrect(recipe.id, 'task-verification-gap');
    const disproved = h.store.memories.find((m) => m.id === recipe.id)!;
    expect(disproved.correctness).toBe(0);
    expect(disproved.strength).toBe(0);
  });

  it('recall noise stays measurable as a bounded pollution proxy', async () => {
    const { service } = makeService();
    const noisy = [item({ content: 'the zebra migration schedule', keywords: 'zebra' })];
    expect(service.recallNoise('build the project with pnpm', noisy)).toBe(1);
    const mixed = [
      item({ content: 'run pnpm build before pushing', keywords: 'pnpm build' }),
      item({ content: 'the zebra migration schedule', keywords: 'zebra' }),
    ];
    expect(service.recallNoise('build the project with pnpm', mixed)).toBeCloseTo(0.5);
  });
});

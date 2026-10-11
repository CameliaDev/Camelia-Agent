/**
 * Context manager — compaction without amnesia.
 *
 * The single promise under test (whitepaper §4.5, metric M5): compaction may drop
 * conversation volume but must never drop the goal, constraints, todos or artifact
 * paths. `protectedSlotRetention()` is the objective measure.
 * @module
 */

import { describe, expect, it } from 'vitest';

import {
  ContextManager,
  emptySlots,
  previewDropped,
  renderSlots,
  structuralSummarizer,
} from '../src/context/ContextManager.js';
import { resolveConfig } from '../src/config.js';

function manager(contextWindow = 128_000): ContextManager {
  return new ContextManager(resolveConfig({ contextWindow }), emptySlots());
}

describe('ContextManager — protected slots', () => {
  it('renders the goal, constraints, todos and artifacts into the system block', () => {
    const ctx = manager();
    ctx.setGoal('add a CONTRIBUTING.md');
    ctx.addConstraint('do not touch tests');
    ctx.setTodos(['[pending] write file']);
    ctx.addArtifact('CONTRIBUTING.md');

    const rendered = renderSlots(ctx.protectedSlots);
    expect(rendered).toContain('goal: add a CONTRIBUTING.md');
    expect(rendered).toContain('do not touch tests');
    expect(rendered).toContain('[pending] write file');
    expect(rendered).toContain('CONTRIBUTING.md');
  });

  it('de-duplicates constraints and artifacts', () => {
    const ctx = manager();
    ctx.addConstraint('a');
    ctx.addConstraint('a');
    ctx.addArtifact('x');
    ctx.addArtifact('x');
    expect(ctx.protectedSlots.constraints).toEqual(['a']);
    expect(ctx.protectedSlots.artifacts).toEqual(['x']);
  });

  it('reports full retention when every slot survives', () => {
    const ctx = manager();
    ctx.setGoal('g');
    ctx.addConstraint('c');
    ctx.setTodos(['t']);
    ctx.addArtifact('a');
    expect(ctx.protectedSlotRetention()).toBe(1);
  });

  it('reports full retention when there is nothing to protect', () => {
    expect(manager().protectedSlotRetention()).toBe(1);
  });
});

describe('ContextManager — budget', () => {
  it('exposes the window, the soft limit and current usage', () => {
    const ctx = manager(1_000);
    ctx.append({ role: 'user', content: 'x'.repeat(400) });
    const budget = ctx.budget();
    expect(budget.window).toBe(1_000);
    expect(budget.softLimit).toBe(800);
    expect(budget.used).toBeGreaterThan(0);
  });

  it('does not request compaction while under the soft limit', () => {
    const ctx = manager(100_000);
    ctx.append({ role: 'user', content: 'small' });
    expect(ctx.shouldCompact()).toBe(false);
  });

  it('requests compaction once usage crosses the soft limit', () => {
    const ctx = manager(200);
    ctx.append({ role: 'user', content: 'x'.repeat(2_000) });
    expect(ctx.shouldCompact()).toBe(true);
  });
});

describe('ContextManager — compaction', () => {
  it('folds older messages while keeping the most recent ones live', async () => {
    const ctx = manager(100_000);
    for (let i = 0; i < 12; i += 1) ctx.append({ role: 'user', content: `message ${i}` });
    expect(ctx.liveCount).toBe(12);

    const result = await ctx.compact('soft-limit', 6);
    expect(result.performed).toBe(true);
    expect(result.dropped).toBe(6);
    // 6 survivors + 1 pinned summary message.
    expect(ctx.liveCount).toBe(7);
  });

  it('preserves every protected slot across compaction (metric M5)', async () => {
    const ctx = manager(100_000);
    ctx.setGoal('ship the CONTRIBUTING guide');
    ctx.addConstraint('do not modify tests');
    ctx.setTodos(['[pending] write CONTRIBUTING.md']);
    ctx.addArtifact('CONTRIBUTING.md');
    for (let i = 0; i < 20; i += 1) ctx.append({ role: 'user', content: `noise ${i}` });

    const result = await ctx.compact('hard-limit', 4);
    expect(result.performed).toBe(true);
    expect(result.retention).toBe(1);
    expect(ctx.protectedSlotRetention()).toBe(1);

    const built = ctx.build('SYSTEM');
    expect(built.messages[0]!.content).toContain('ship the CONTRIBUTING guide');
    expect(built.messages[0]!.content).toContain('do not modify tests');
  });

  it('never compacts pinned entries', async () => {
    const ctx = manager(100_000);
    ctx.append({ role: 'system', content: 'PINNED GOAL' }, { pinned: true });
    for (let i = 0; i < 10; i += 1) ctx.append({ role: 'user', content: `n${i}` });
    await ctx.compact('soft-limit', 2);
    expect(ctx.build('S').messages.some((m) => m.content === 'PINNED GOAL')).toBe(true);
  });

  it('does nothing when there is nothing eligible to drop', async () => {
    const ctx = manager(100_000);
    ctx.append({ role: 'user', content: 'one' });
    const result = await ctx.compact('soft-limit', 6);
    expect(result.performed).toBe(false);
    expect(result.dropped).toBe(0);
  });

  it('records the compaction in the log for the UI panel', async () => {
    const ctx = manager(100_000);
    for (let i = 0; i < 12; i += 1) ctx.append({ role: 'user', content: `m${i}` });
    await ctx.compact('soft-limit', 4);
    expect(ctx.snapshot().log.length).toBe(1);
    expect(ctx.snapshot().log[0]).toContain('folded');
  });
});

describe('ContextManager — dropped originals', () => {
  it('carries the original text of every dropped message', async () => {
    const ctx = manager(100_000);
    ctx.append({ role: 'user', content: 'please inspect package.json' });
    ctx.append({ role: 'tool', name: 'fs.read', content: '{"name":"camelia"}' });
    for (let i = 0; i < 4; i += 1) ctx.append({ role: 'user', content: `keep ${i}` });

    const result = await ctx.compact('soft-limit', 4);
    expect(result.performed).toBe(true);
    expect(result.dropped).toBe(2);
    expect(result.droppedPreviews).toHaveLength(2);
    expect(result.droppedPreviews[0]).toEqual({
      role: 'user',
      content: 'please inspect package.json',
      truncated: false,
    });
    expect(result.droppedPreviews[1]?.name).toBe('fs.read');
    expect(result.droppedPreviews[1]?.content).toContain('camelia');
  });

  it('returns no originals when nothing is dropped', async () => {
    const ctx = manager(100_000);
    ctx.append({ role: 'user', content: 'one' });
    const result = await ctx.compact('soft-limit', 6);
    expect(result.droppedPreviews).toEqual([]);
  });
});

describe('previewDropped', () => {
  it('keeps only the most recent victims beyond the cap', () => {
    const messages = Array.from({ length: 20 }, (_v, i) => ({ role: 'user' as const, content: `m${i}` }));
    const previews = previewDropped(messages);
    expect(previews).toHaveLength(12);
    expect(previews[0]?.content).toBe('m8');
    expect(previews.at(-1)?.content).toBe('m19');
  });

  it('truncates a long body and flags it', () => {
    const previews = previewDropped([{ role: 'tool', name: 'shell.exec', content: 'x'.repeat(5_000) }]);
    expect(previews[0]?.content).toHaveLength(2_000);
    expect(previews[0]?.truncated).toBe(true);
    expect(previews[0]?.name).toBe('shell.exec');
  });
});

describe('structuralSummarizer', () => {
  it('keeps role and tool names, and truncates long bodies', async () => {
    const summary = await structuralSummarizer([
      { role: 'user', content: 'hello world' },
      { role: 'tool', name: 'fs.read', content: 'y'.repeat(500) },
    ]);
    expect(summary).toContain('- user: hello world');
    expect(summary).toContain('tool:fs.read');
    expect(summary.length).toBeLessThan(400);
  });
});

describe('ContextManager — snapshot', () => {
  it('reports live and compacted counts plus the slots', async () => {
    const ctx = manager(100_000);
    ctx.setGoal('g');
    for (let i = 0; i < 10; i += 1) ctx.append({ role: 'user', content: `m${i}` });
    await ctx.compact('soft-limit', 4);
    const snapshot = ctx.snapshot();
    expect(snapshot.live).toBeGreaterThan(0);
    expect(snapshot.compacted).toBeGreaterThan(0);
    expect(snapshot.slots.goal).toBe('g');
  });

  it('emptySlots is a fresh, empty slot set', () => {
    expect(emptySlots()).toEqual({ goal: '', constraints: [], todos: [], artifacts: [] });
  });
});
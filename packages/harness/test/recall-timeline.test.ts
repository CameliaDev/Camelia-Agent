/**
 * Recall timeline fold (Iteration 26 — Stage 2).
 *
 * `buildRecallTimeline` turns persisted `memory.recalled` events into the
 * panel's visible recall history: one hit per memory, chronological, with the
 * layer, content snippet, matchedBy, noise and the later-downgrade annotation.
 * The 口径 must stay identical to `computeRecallNoiseAggregate` — these tests
 * pin sorting, annotation and the two filters (memoryId / since / limit), plus
 * the old-event defaults.
 * @module
 */

import { describe, expect, it } from 'vitest';

import type { StoredEvent } from '@camelia/core';

import { buildRecallTimeline, computeRecallNoiseAggregate } from '../src/memory/recallNoise.js';

function recalled(
  ts: number,
  ids: string[],
  provenance: Array<{ memoryId: string; layer: string; matchedBy: string }>,
  noise = 0,
): StoredEvent {
  return {
    type: 'memory.recalled',
    payload: { count: ids.length, ids, noise, provenance },
    traceId: 'trc',
    ts,
    seq: ts,
  };
}

function downgraded(memoryId: string, ts: number): StoredEvent {
  return { type: 'memory.downgraded', payload: { memoryId, reason: 'user-correction', correctness: 0 }, traceId: 'trc', ts, seq: ts };
}

describe('buildRecallTimeline — one hit per recalled memory, chronological', () => {
  it('emits one hit per id, in ascending time order', () => {
    const events = [
      recalled(30, ['b'], [{ memoryId: 'b', layer: 'long', matchedBy: 'todo' }], 0.2),
      recalled(10, ['a'], [{ memoryId: 'a', layer: 'short', matchedBy: 'seed' }], 0.5),
      recalled(20, ['c'], [{ memoryId: 'c', layer: 'procedural', matchedBy: 'recipe' }], 0),
    ];
    const hits = buildRecallTimeline(events);
    expect(hits.map((h) => h.memoryId)).toEqual(['a', 'c', 'b']);
    expect(hits.map((h) => h.at)).toEqual([10, 20, 30]);
    expect(hits[0]).toMatchObject({ layer: 'short', matchedBy: 'seed', noise: 0.5, downgraded: false });
    expect(hits[1]).toMatchObject({ layer: 'procedural', matchedBy: 'recipe' });
  });

  it('attaches content from the contentById map, truncated to the snippet cap', () => {
    const longContent = 'x'.repeat(500);
    const hits = buildRecallTimeline(
      [recalled(1, ['a'], [{ memoryId: 'a', layer: 'long', matchedBy: 'k' }])],
      { contentById: new Map([['a', longContent]]), snippetLength: 40 },
    );
    expect(hits[0]!.contentSnippet.length).toBe(40);
  });

  it('defaults a missing content to an empty snippet (memory may be gone)', () => {
    const hits = buildRecallTimeline([recalled(1, ['a'], [{ memoryId: 'a', layer: 'long', matchedBy: 'k' }])]);
    expect(hits[0]!.contentSnippet).toBe('');
  });
});

describe('buildRecallTimeline — 口径 consistency with the noise aggregate', () => {
  it('marks a hit downgraded exactly when the aggregate counts it into downgradedHits', () => {
    const events = [
      recalled(10, ['a', 'b'], [
        { memoryId: 'a', layer: 'long', matchedBy: 'x' },
        { memoryId: 'b', layer: 'short', matchedBy: 'y' },
      ]),
      recalled(20, ['a'], [{ memoryId: 'a', layer: 'long', matchedBy: 'x' }]),
      downgraded('a', 30),
    ];
    const hits = buildRecallTimeline(events);
    expect(hits.filter((h) => h.downgraded).map((h) => h.memoryId)).toEqual(['a', 'a']);
    expect(hits.find((h) => h.memoryId === 'b')?.downgraded).toBe(false);

    // The aggregate's downgradedHits counts the same two a-hits.
    const agg = computeRecallNoiseAggregate(events);
    expect(agg.totalHits).toBe(3); // 2 + 1
    expect(agg.downgradedHits).toBe(2);
    expect(hits.filter((h) => h.downgraded).length).toBe(agg.downgradedHits);
    expect(hits.length).toBe(agg.totalHits);
  });

  it('a memory downgraded in the window is annotated on every earlier hit (same set as the aggregate)', () => {
    const events = [recalled(10, ['a'], [{ memoryId: 'a', layer: 'long', matchedBy: 'x' }]), downgraded('a', 5)];
    const hits = buildRecallTimeline(events);
    expect(hits[0]!.downgraded).toBe(true);
    expect(computeRecallNoiseAggregate(events).downgradedHits).toBe(1);
  });
});

describe('buildRecallTimeline — filters and old-event defaults', () => {
  it('filters by memoryId, since and limit (most recent wins)', () => {
    const events = [
      recalled(10, ['a'], [{ memoryId: 'a', layer: 'long', matchedBy: 'x' }]),
      recalled(20, ['b'], [{ memoryId: 'b', layer: 'short', matchedBy: 'y' }]),
      recalled(30, ['c'], [{ memoryId: 'c', layer: 'long', matchedBy: 'z' }]),
    ];
    expect(buildRecallTimeline(events, { memoryId: 'b' }).map((h) => h.memoryId)).toEqual(['b']);
    expect(buildRecallTimeline(events, { since: 20 }).map((h) => h.at)).toEqual([20, 30]);
    expect(buildRecallTimeline(events, { limit: 2 }).map((h) => h.at)).toEqual([20, 30]); // most recent two
    expect(buildRecallTimeline(events, { since: 15, limit: 1 }).map((h) => h.at)).toEqual([30]);
  });

  it('reads old events with defaults: no ts → 0, missing provenance → short + empty matchedBy, missing noise → 0', () => {
    const old = [
      { type: 'memory.recalled', payload: { count: 1, ids: ['a'], noise: 0.4, provenance: [] } },
      { type: 'memory.recalled', payload: { count: 1, ids: ['b'], provenance: [{ memoryId: 'b', layer: 'global', matchedBy: '' }] } },
    ];
    const hits = buildRecallTimeline(old);
    expect(hits[0]).toMatchObject({ at: 0, layer: 'short', matchedBy: '', noise: 0.4, contentSnippet: '' });
    expect(hits[1]).toMatchObject({ at: 0, layer: 'long', matchedBy: '', noise: 0 });
    // 'global' provenance normalises to the long layer (Iteration 26).
    expect(hits[1]!.layer).toBe('long');
  });

  it('normalises layer: global→long, session→short, known layers kept, unknown→short', () => {
    const events = [
      recalled(1, ['a'], [{ memoryId: 'a', layer: 'global', matchedBy: '' }]),
      recalled(2, ['b'], [{ memoryId: 'b', layer: 'session', matchedBy: '' }]),
      recalled(3, ['c'], [{ memoryId: 'c', layer: 'procedural', matchedBy: '' }]),
      recalled(4, ['d'], [{ memoryId: 'd', layer: 'weird', matchedBy: '' }]),
    ];
    const layers = new Map(buildRecallTimeline(events).map((h) => [h.memoryId, h.layer]));
    expect(layers.get('a')).toBe('long');
    expect(layers.get('b')).toBe('short');
    expect(layers.get('c')).toBe('procedural');
    expect(layers.get('d')).toBe('short');
  });
});

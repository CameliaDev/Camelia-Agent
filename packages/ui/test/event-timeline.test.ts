/**
 * Events panel: collapse chat.delta spam into graph nodes.
 * @module
 */
import { describe, expect, it } from 'vitest';

import type { TimelineEntry } from '@camelia/agent/view';

import { buildEventTimeline, nodeMatchesFilter } from '../src/lib/event-timeline.js';

function entry(type: string, at: number, summary?: string): TimelineEntry {
  return { type, at, summary, traceId: 't1' } as TimelineEntry;
}

describe('buildEventTimeline', () => {
  it('folds consecutive chat.delta into one group', () => {
    const nodes = buildEventTimeline([
      entry('chat.received', 1, 'hi'),
      entry('chat.delta', 2, '+3'),
      entry('chat.delta', 3, '+5'),
      entry('chat.delta', 4, '+2'),
      entry('chat.message', 5, 'done'),
    ]);
    expect(nodes.map((n) => n.kind)).toEqual(['event', 'delta-group', 'event']);
    const group = nodes[1]!;
    expect(group.kind).toBe('delta-group');
    if (group.kind === 'delta-group') {
      expect(group.count).toBe(3);
      expect(group.chars).toBe(10);
    }
  });

  it('can keep raw deltas when includeDeltas is true', () => {
    const nodes = buildEventTimeline(
      [entry('chat.delta', 1, '+1'), entry('chat.delta', 2, '+1')],
      { includeDeltas: true },
    );
    expect(nodes.every((n) => n.kind === 'event')).toBe(true);
    expect(nodes).toHaveLength(2);
  });
});

describe('nodeMatchesFilter', () => {
  it('matches delta groups on stream/delta', () => {
    const node = buildEventTimeline([entry('chat.delta', 1, '+4')])[0]!;
    expect(nodeMatchesFilter(node, 'delta')).toBe(true);
    expect(nodeMatchesFilter(node, 'stream')).toBe(true);
    expect(nodeMatchesFilter(node, 'plan')).toBe(false);
  });
});

/**
 * Cross-session recall-noise aggregate (Iteration 22 — measurable health).
 *
 * The per-recall `memory.recall_noise` sample (Iteration 20) tells the user how
 * polluted *one* recall was. This module answers the health question across
 * sessions: of all the memory hits we served, how many belonged to items that
 * were later disproved (downgraded)? That is the pollution rate the correction
 * channel (Iteration 21 `markIncorrect`) feeds the denominator into.
 *
 * 口径 (definition, pinned by tests):
 *   totalHits      = Σ over `memory.recalled` events of `count`
 *   downgradedHits = Σ over `memory.downgraded` events of how many prior
 *                    `memory.recalled` events included that memoryId
 *   noiseRate      = downgradedHits / totalHits  (0 when totalHits = 0)
 *
 * A memory counts once per recall event that included it — "how many times did
 * the engine serve an item that turned out wrong". A clean store with no
 * downgrades has noiseRate 0; a store that keeps serving disproved facts drifts
 * toward 1.
 * @module
 */

/** Any event-shaped object the fold can read — persisted `StoredEvent` included. */
export interface AggregateEventLike {
  type: string;
  payload: unknown;
}

export interface RecallNoiseAggregate {
  /** Total memory hits served across the window. */
  totalHits: number;
  /** Hits that belonged to an item later marked known-bad. */
  downgradedHits: number;
  /** downgradedHits / totalHits; 0 when there were no hits. */
  noiseRate: number;
  /** Count of distinct downgraded memories in the window. */
  downgradedMemories: number;
}

/**
 * Fold a list of persisted events into the aggregate.
 *
 * Events may be `StoredEvent`-shaped ({ type, payload }) or `DomainEvent`-shaped;
 * only `memory.recalled` and `memory.downgraded` are read, everything else is
 * ignored. The fold is order-independent for the two counters used here.
 */
export function computeRecallNoiseAggregate(
  events: ReadonlyArray<AggregateEventLike>,
): RecallNoiseAggregate {
  let totalHits = 0;
  let downgradedHits = 0;
  const downgraded = new Set<string>();

  for (const event of events) {
    if (event.type === 'memory.recalled') {
      const payload = event.payload as { count?: unknown };
      const count = typeof payload?.count === 'number' ? payload.count : 0;
      totalHits += Number.isFinite(count) ? Math.max(0, count) : 0;
    } else if (event.type === 'memory.downgraded') {
      const payload = event.payload as { memoryId?: unknown };
      if (typeof payload?.memoryId === 'string') downgraded.add(payload.memoryId);
    }
  }

  for (const event of events) {
    if (event.type !== 'memory.recalled') continue;
    const payload = event.payload as { ids?: unknown };
    const ids = Array.isArray(payload?.ids) ? payload.ids.filter((id): id is string => typeof id === 'string') : [];
    for (const id of ids) {
      if (downgraded.has(id)) downgradedHits += 1;
    }
  }

  return {
    totalHits,
    downgradedHits,
    noiseRate: totalHits > 0 ? downgradedHits / totalHits : 0,
    downgradedMemories: downgraded.size,
  };
}

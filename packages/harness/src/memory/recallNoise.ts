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

import type { Id, MemoryLayer } from '@camelia/core';

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

// ---------------------------------------------------------------------------
// Recall timeline (Iteration 26 — the panel's visible recall history)
// ---------------------------------------------------------------------------

export interface RecallTimelineOptions {
  /** Only hits for this memory. */
  memoryId?: Id;
  /** Only hits at or after this timestamp. */
  since?: number;
  /** Keep only the most recent N hits (after filtering and sorting). */
  limit?: number;
  /**
   * Pre-resolved content by memory id. The service loads contents once and hands
   * them in — the fold stays a pure, synchronous function.
   */
  contentById?: ReadonlyMap<string, string>;
  /** Cap on each content snippet length (default 120 chars). */
  snippetLength?: number;
}

/** One persisted recall hit, as the memory panel's timeline shows it. */
export interface RecallTimelineHit {
  /** When the recall happened (event timestamp, ms epoch). */
  at: number;
  memoryId: Id;
  /** Normalised layer: global→long, session→short, known layers kept. */
  layer: MemoryLayer;
  /** Memory content at query time, truncated. Empty when the item is gone. */
  contentSnippet: string;
  /** Which keyword matched ("via"), empty when the event carried none. */
  matchedBy: string;
  /** The recall's noise (fraction of returned items sharing no keyword). */
  noise: number;
  /** Whether the memory was later judged incorrect / downgraded in this window. */
  downgraded: boolean;
}

/**
 * Fold persisted events into the recall timeline (Iteration 26).
 *
 * 口径 consistency with {@link computeRecallNoiseAggregate}: both read the same
 * `memory.recalled` / `memory.downgraded` events, and the downgrade set here is
 * built exactly the way the aggregate builds it (any downgraded event for a
 * memory marks its hits in this window — the aggregate counts the same hits into
 * `downgradedHits`). For well-formed engine events `ids.length === count`, so
 * the per-hit list adds up to the same `totalHits`. A malformed or very old
 * event where they disagree is read on the `ids` basis for the timeline (a hit
 * needs a concrete memory) and on the `count` basis for the aggregate — the
 * only divergence, and it is bounded by how the engine itself emits events.
 *
 * Old events read with defaults: no `ts` → 0, missing provenance → layer
 * `short` + empty matchedBy, missing noise → 0, missing content → empty snippet.
 */
export function buildRecallTimeline(
  events: ReadonlyArray<AggregateEventLike>,
  options: RecallTimelineOptions = {},
): RecallTimelineHit[] {
  const contentById = options.contentById ?? new Map<string, string>();
  const snippetLength = options.snippetLength ?? 120;

  const downgraded = new Set<string>();
  for (const event of events) {
    if (event.type !== 'memory.downgraded') continue;
    const payload = event.payload as { memoryId?: unknown };
    if (typeof payload?.memoryId === 'string') downgraded.add(payload.memoryId);
  }

  const hits: RecallTimelineHit[] = [];
  for (const event of events) {
    if (event.type !== 'memory.recalled') continue;
    const payload = event.payload as {
      noise?: unknown;
      ids?: unknown;
      provenance?: unknown;
    };
    const ts = typeof (event as { ts?: unknown }).ts === 'number' ? (event as unknown as { ts: number }).ts : 0;
    if (options.since !== undefined && ts < options.since) continue;
    const noise = typeof payload?.noise === 'number' && Number.isFinite(payload.noise) ? payload.noise : 0;
    const ids = Array.isArray(payload?.ids) ? payload.ids.filter((id): id is string => typeof id === 'string') : [];
    const provenance = (
      Array.isArray(payload?.provenance) ? payload.provenance : []
    ) as Array<{ memoryId?: unknown; layer?: unknown; matchedBy?: unknown }>;
    const byId = new Map<string, { layer?: unknown; matchedBy?: unknown }>();
    for (const entry of provenance) {
      if (typeof entry?.memoryId === 'string') byId.set(entry.memoryId, entry);
    }
    for (const memoryId of ids) {
      if (options.memoryId !== undefined && memoryId !== options.memoryId) continue;
      const entry = byId.get(memoryId);
      const content = contentById.get(memoryId) ?? '';
      hits.push({
        at: ts,
        memoryId,
        layer: normaliseLayer(entry?.layer),
        contentSnippet: contentSnippetOf(content, snippetLength),
        matchedBy: typeof entry?.matchedBy === 'string' ? entry.matchedBy : '',
        noise,
        downgraded: downgraded.has(memoryId),
      });
    }
  }

  // Chronological, stable; `limit` keeps the most recent hits.
  hits.sort((a, b) => a.at - b.at || (a.memoryId < b.memoryId ? -1 : a.memoryId > b.memoryId ? 1 : 0));
  if (options.limit !== undefined && options.limit > 0 && hits.length > options.limit) {
    return hits.slice(hits.length - options.limit);
  }
  return hits;
}

/** Provenance layers are `item.layer ?? item.scope` — scope strings normalise. */
function normaliseLayer(value: unknown): MemoryLayer {
  if (value === 'long' || value === 'short' || value === 'procedural' || value === 'working') return value;
  if (value === 'global') return 'long';
  if (value === 'session') return 'short';
  return 'short';
}

function contentSnippetOf(text: string, max: number): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length > max ? compact.slice(0, max) : compact;
}

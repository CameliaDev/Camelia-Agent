/**
 * Value scoring for memories (Iteration 20 — human-like memory lifecycle).
 *
 * The forgetting policy is *value-driven*, not mechanical time decay:
 *
 *   value = importance × recency(最近命中) × correctness(验证过的正确性)
 *
 * Time enters only through `lastHitAt` — how recently the memory proved useful —
 * so a memory that is never recalled decays, while one that keeps being used
 * stays strong. `ttl` (when set) merely picks the half-life of that recency
 * curve; an absent ttl means the default half-life applies.
 * @module
 */

/** Default half-life of the recency curve when an item has no `ttl`. */
export const DEFAULT_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface MemoryValueInput {
  /** 0..1 intrinsic importance. */
  importance: number;
  /** 0..1 validated correctness. */
  correctness: number;
  /** Last successful recall (epoch ms); falls back to `createdAt`. */
  lastHitAt?: number;
  /** Creation time (epoch ms) — used when the item was never hit. */
  createdAt: number;
  /** Item ttl in ms; null/absent = default half-life. */
  ttl?: number | null;
  /** Evaluation time (epoch ms). */
  now: number;
  /** Override for the half-life (tests use small values). */
  halfLifeMs?: number;
}

/** Clamp a 0..1 score. */
function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Value of a memory at `now`.
 *
 * recency = 1 / (1 + age/halfLife), so a fresh hit scores ~1 and an item unused
 * for many half-lives approaches 0 — but importance and correctness keep
 * high-value memories alive for a long time without being touched.
 */
export function memoryValue(input: MemoryValueInput): number {
  const importance = clamp01(input.importance);
  const correctness = clamp01(input.correctness);
  const reference = input.lastHitAt ?? input.createdAt;
  const age = Math.max(0, input.now - reference);
  const halfLife =
    input.ttl && input.ttl > 0 ? input.ttl / 2 : (input.halfLifeMs ?? DEFAULT_HALF_LIFE_MS);
  const recency = 1 / (1 + age / Math.max(1, halfLife));
  return importance * recency * correctness;
}

/** Effective half-life for an item (its `ttl` halves it, else the default). */
export function halfLifeOf(input: Pick<MemoryValueInput, 'ttl' | 'halfLifeMs'>): number {
  return input.ttl && input.ttl > 0 ? input.ttl / 2 : (input.halfLifeMs ?? DEFAULT_HALF_LIFE_MS);
}

/**
 * Recency component of the value formula at `now` — how recently the memory
 * proved useful. Exposed separately so the panel can show the full
 * `importance × recency × correctness` decomposition.
 */
export function recencyScore(reference: number, now: number, halfLifeMs: number): number {
  const age = Math.max(0, now - reference);
  return 1 / (1 + age / Math.max(1, halfLifeMs));
}

/**
 * Spaced-repetition style next review time.
 *
 * Each successful hit pushes the next reactivation further out: interval grows
 * linearly with the hit count, so well-known memories are reviewed rarely and
 * fresh ones stay in rotation.
 */
export function nextReviewAt(now: number, hits: number, baseIntervalMs = 24 * 60 * 60 * 1000): number {
  return now + baseIntervalMs * (hits + 1);
}

/** Common English stopwords — "meaningful words" for overlap checks. */
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'has', 'was',
  'are', 'were', 'been', 'but', 'not', 'you', 'your', 'they', 'them', 'will',
  'would', 'can', 'could', 'should', 'into', 'about', 'than', 'then', 'when',
]);

/** Tokenise a string for keyword-overlap relevance checks. */
export function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length > 2 && !STOPWORDS.has(word)),
  );
}

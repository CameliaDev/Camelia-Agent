/**
 * Scoring rules for the prediction–error loop (ARCH-COGNITION §3.3–§3.4).
 *
 * Deterministic. No model, no clock, no randomness. Score is the continuous
 * signal; surprise is the discrete trigger. They are stored separately so a
 * later threshold change does not rewrite history.
 * @module
 */

import type { ObservedValue, PredictionSource, PredictionValue, ScoringRule } from '@camelia/core';

/** Samples required before a residual may set `surprise`. Below this, record the score and stay quiet. */
export const DEFAULT_MIN_SAMPLES = 8;
/** Percentile of the recent window used as the surprise threshold. */
export const DEFAULT_SURPRISE_PERCENTILE = 80;
/** How many recent residuals form that window. */
export const DEFAULT_SURPRISE_WINDOW = 50;
/** Samples a backoff level needs before its estimate may be used. */
export const DEFAULT_MIN_LEVEL_SAMPLES = 3;

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Binary Brier: `(p − o)²`.
 *
 * Predicting 0.95 and being wrong (0.9025) is much worse than predicting 0.5
 * and being wrong (0.25). Without that gap the estimator never learns to say
 * it is unsure.
 */
export function binaryBrier(probability: number, occurred: boolean): number {
  const p = clamp01(probability);
  const o = occurred ? 1 : 0;
  const d = p - o;
  return d * d;
}

/**
 * Multi-class Brier, normalised onto `[0, 1]`.
 *
 * §3.3 writes `Σ (p_i − o_i)²`. For two classes that sum is `2(p−o)²`, and the
 * same section says the binary case degenerates to `(p−o)²` with maximum 1.
 * Dividing the sum by 2 is that degeneration, and it keeps a fully wrong
 * one-hot (sum = 2) at 1 for three or more classes as well.
 */
export function categoricalBrier(probs: Readonly<Record<string, number>>, observedLabel: string): number {
  const labels = new Set<string>([...Object.keys(probs), observedLabel]);
  let sum = 0;
  for (const label of labels) {
    const p = probs[label] ?? 0;
    const o = label === observedLabel ? 1 : 0;
    const d = p - o;
    sum += d * d;
  }
  return Math.min(1, sum / 2);
}

/**
 * Normalised absolute error.
 *
 * `max(1, |observed|)` avoids divide-by-zero, stops tiny observations from
 * turning noise into a score of 1, and makes "3 vs 4" and "300 vs 400" both
 * 0.25. `min(1, ·)` shares Brier's range.
 */
export function nrmse(predicted: number, observed: number): number {
  if (!Number.isFinite(predicted) || !Number.isFinite(observed)) return 1;
  const denom = Math.max(1, Math.abs(observed));
  return Math.min(1, Math.abs(predicted - observed) / denom);
}

/** Jaccard distance. Both sides empty is 0: expecting nothing and touching nothing is exact. */
export function jaccardDistance(predicted: readonly string[], observed: readonly string[]): number {
  const a = new Set(predicted.map(normalisePath));
  const b = new Set(observed.map(normalisePath));
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection += 1;
  const union = a.size + b.size - intersection;
  if (union === 0) return 0;
  return 1 - intersection / union;
}

export function normalisePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

export function scoreValue(predicted: PredictionValue, observed: ObservedValue): { score: number; rule: ScoringRule } {
  if (predicted.kind === 'categorical' && observed.kind === 'categorical') {
    return { score: binaryBrier(predicted.p, observed.label === predicted.label), rule: 'brier' };
  }
  if (predicted.kind === 'categorical-multi' && observed.kind === 'categorical') {
    return { score: categoricalBrier(predicted.probs, observed.label), rule: 'categorical-brier' };
  }
  if (predicted.kind === 'numeric' && observed.kind === 'numeric') {
    return { score: nrmse(predicted.value, observed.value), rule: 'nrmse' };
  }
  if (predicted.kind === 'set' && observed.kind === 'set') {
    return { score: jaccardDistance(predicted.items, observed.items), rule: 'jaccard' };
  }
  throw new Error(`cannot score ${predicted.kind} against ${observed.kind}`);
}

/** Nearest-rank percentile. `p` is 0..100. */
export function percentileNearestRank(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[rank] ?? 0;
}

export interface SurpriseInput {
  score: number;
  source: PredictionSource;
  /** Observations already absorbed at the signature level that produced the prediction. */
  sampleCount: number;
  /** Residuals at that level, oldest first, not including `score`. */
  recentScores: readonly number[];
  minSamples?: number;
  percentile?: number;
  window?: number;
}

/**
 * Surprise gate.
 *
 * - `source === 'prior'` is never a surprise. A cold-start guess is for display
 *   and routing; its error is not evidence the estimator understood the case.
 * - `sampleCount < minSamples` (default 8) records the residual and stays silent.
 * - Otherwise the threshold is the P-th percentile of the last M residuals.
 */
export function decideSurprise(input: SurpriseInput): { surprise: boolean; threshold: number | null } {
  const minSamples = input.minSamples ?? DEFAULT_MIN_SAMPLES;
  const percentile = input.percentile ?? DEFAULT_SURPRISE_PERCENTILE;
  const window = input.window ?? DEFAULT_SURPRISE_WINDOW;
  if (input.source === 'prior') return { surprise: false, threshold: null };
  if (input.sampleCount < minSamples) return { surprise: false, threshold: null };
  const recent = input.recentScores.slice(-window);
  if (recent.length < minSamples) return { surprise: false, threshold: null };
  const threshold = percentileNearestRank(recent, percentile);
  return { surprise: input.score >= threshold, threshold };
}

/** "expected pass (0.75) → observed fail" */
export function contrastLine(predicted: PredictionValue, observed: ObservedValue): string {
  return `expected ${formatPrediction(predicted)} → observed ${formatObserved(observed)}`;
}

function formatPrediction(value: PredictionValue): string {
  switch (value.kind) {
    case 'categorical':
      return `${value.label} (${clamp01(value.p).toFixed(2)})`;
    case 'categorical-multi': {
      const top = Object.entries(value.probs).sort((a, b) => b[1] - a[1])[0];
      return top ? `${top[0]} (${top[1].toFixed(2)})` : 'unknown';
    }
    case 'numeric':
      return `${trimNumber(value.value)} ${value.unit}`.trim();
    case 'set':
      return value.items.length === 0 ? '∅' : value.items.join(', ');
    default:
      return 'unknown';
  }
}

function formatObserved(value: ObservedValue): string {
  switch (value.kind) {
    case 'categorical':
      return value.label;
    case 'numeric':
      return trimNumber(value.value);
    case 'set':
      return value.items.length === 0 ? '∅' : value.items.join(', ');
    default:
      return 'unknown';
  }
}

function trimNumber(value: number): string {
  if (!Number.isFinite(value)) return 'NaN';
  const rounded = Math.round(value * 1000) / 1000;
  return String(rounded);
}

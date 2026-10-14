/**
 * Hierarchical backoff table (ARCH-COGNITION §4.3).
 *
 * Lookup walks L3 → L-1 and returns the first level with `n >= minLevelSamples`.
 * If none qualify, the caller-supplied prior is the answer and `source` is
 * `'prior'`. The hot path is arithmetic on this table: no model call.
 *
 * Each observation is absorbed by every ancestor key. Levels do not share rows;
 * the chain is several keys, not a nested document.
 * @module
 */

import type { ObservableKind, ObservedValue, PredictionValue, SituationSignature } from '@camelia/core';

import { backoffChain, signatureKeyAt } from './signature.js';
import { clamp01, DEFAULT_MIN_LEVEL_SAMPLES } from './score.js';

interface CategoricalRow {
  kind: 'categorical';
  counts: Record<string, number>;
}
interface NumericRow {
  kind: 'numeric';
  sum: number;
  unit: string;
}
interface SetRow {
  kind: 'set';
  elementCounts: Record<string, number>;
}

interface StatRow {
  n: number;
  estimate: CategoricalRow | NumericRow | SetRow;
  /** Residuals of predictions this exact key emitted, oldest first. */
  residualScores: number[];
  sumScore: number;
  sumScoreSq: number;
  sumConfidence: number;
}

export interface BackoffHit {
  readonly level: number;
  readonly signatureKey: string;
  readonly n: number;
  readonly source: 'empirical-backoff' | 'prior';
  readonly value: PredictionValue;
  readonly confidence: number;
  readonly basis: string;
}

export interface BackoffTableOptions {
  readonly minLevelSamples?: number;
}

export class BackoffTable {
  private readonly rows = new Map<string, StatRow>();
  readonly minLevelSamples: number;

  constructor(options: BackoffTableOptions = {}) {
    this.minLevelSamples = options.minLevelSamples ?? DEFAULT_MIN_LEVEL_SAMPLES;
  }

  /**
   * Most specific level with enough samples. Otherwise the prior, at level −1.
   * The prior is not written into the table by this call.
   */
  lookup(signature: SituationSignature, kind: ObservableKind, prior: PredictionValue, priorBasis: string, priorConfidence = 0.25): BackoffHit {
    for (const link of backoffChain(signature)) {
      const row = this.rows.get(rowKey(link.key, kind));
      if (!row || row.n < this.minLevelSamples) continue;
      const value = toPredictionValue(row);
      return {
        level: link.level,
        signatureKey: link.key,
        n: row.n,
        source: 'empirical-backoff',
        value,
        confidence: confidenceOf(row, value),
        basis: basisOf(link.level, row),
      };
    }
    return {
      level: -1,
      signatureKey: signatureKeyAt(signature, -1),
      n: this.rows.get(rowKey('*', kind))?.n ?? 0,
      source: 'prior',
      value: prior,
      confidence: clamp01(priorConfidence),
      basis: priorBasis,
    };
  }

  /** Fold one observation into every level of the chain. Does not score. */
  absorb(signature: SituationSignature, kind: ObservableKind, observed: ObservedValue, unit?: string): void {
    for (const link of backoffChain(signature)) {
      const key = rowKey(link.key, kind);
      const row = this.rows.get(key) ?? emptyRow(observed, unit);
      absorbInto(row, observed);
      if (unit && row.estimate.kind === 'numeric' && !row.estimate.unit) row.estimate.unit = unit;
      this.rows.set(key, row);
    }
  }

  /**
   * Remember a residual that this key actually emitted.
   * Used for the surprise window. Does not change `n` — absorb() owns that.
   */
  noteResidual(signatureKey: string, kind: ObservableKind, score: number, confidence: number): void {
    const key = rowKey(signatureKey, kind);
    const row = this.rows.get(key);
    if (!row) return;
    row.residualScores.push(score);
    row.sumScore += score;
    row.sumScoreSq += score * score;
    row.sumConfidence += clamp01(confidence);
  }

  residualScores(signatureKey: string, kind: ObservableKind): readonly number[] {
    return this.rows.get(rowKey(signatureKey, kind))?.residualScores ?? [];
  }

  n(signatureKey: string, kind: ObservableKind): number {
    return this.rows.get(rowKey(signatureKey, kind))?.n ?? 0;
  }
}

function rowKey(signatureKey: string, kind: ObservableKind): string {
  return `${kind}\u0000${signatureKey}`;
}

function emptyRow(observed: ObservedValue, unit?: string): StatRow {
  const estimate: StatRow['estimate'] =
    observed.kind === 'categorical'
      ? { kind: 'categorical', counts: {} }
      : observed.kind === 'numeric'
        ? { kind: 'numeric', sum: 0, unit: unit ?? '' }
        : { kind: 'set', elementCounts: {} };
  return { n: 0, estimate, residualScores: [], sumScore: 0, sumScoreSq: 0, sumConfidence: 0 };
}

function absorbInto(row: StatRow, observed: ObservedValue): void {
  if (observed.kind === 'categorical') {
    if (row.estimate.kind !== 'categorical') row.estimate = { kind: 'categorical', counts: {} };
    const label = observed.label;
    row.estimate.counts[label] = (row.estimate.counts[label] ?? 0) + 1;
  } else if (observed.kind === 'numeric') {
    if (row.estimate.kind !== 'numeric') row.estimate = { kind: 'numeric', sum: 0, unit: '' };
    row.estimate.sum += observed.value;
  } else {
    if (row.estimate.kind !== 'set') row.estimate = { kind: 'set', elementCounts: {} };
    for (const item of new Set(observed.items)) {
      row.estimate.elementCounts[item] = (row.estimate.elementCounts[item] ?? 0) + 1;
    }
  }
  row.n += 1;
}

function toPredictionValue(row: StatRow): PredictionValue {
  const estimate = row.estimate;
  if (estimate.kind === 'categorical') {
    const probs: Record<string, number> = {};
    const n = Math.max(1, row.n);
    for (const [label, count] of Object.entries(estimate.counts)) probs[label] = count / n;
    return { kind: 'categorical-multi', probs };
  }
  if (estimate.kind === 'numeric') {
    return { kind: 'numeric', value: row.n > 0 ? estimate.sum / row.n : 0, unit: estimate.unit || 'count' };
  }
  const items = Object.entries(estimate.elementCounts)
    .filter(([, count]) => row.n > 0 && count / row.n >= 0.5)
    .map(([item]) => item)
    .sort();
  return { kind: 'set', items };
}

function confidenceOf(row: StatRow, value: PredictionValue): number {
  if (value.kind === 'categorical') return clamp01(value.p);
  if (value.kind === 'categorical-multi') {
    const top = Object.values(value.probs).reduce((max, p) => Math.max(max, p), 0);
    return clamp01(top);
  }
  return clamp01(row.n / (row.n + 10));
}

function basisOf(level: number, row: StatRow): string {
  const label = level < 0 ? 'L-1' : `L${level}`;
  const estimate = row.estimate;
  if (estimate.kind === 'categorical') {
    const parts = Object.entries(estimate.counts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, count]) => `${name} ${count}/${row.n}`);
    return `${label} n=${row.n}, ${parts.join(', ')}`;
  }
  if (estimate.kind === 'numeric') {
    const mean = row.n > 0 ? estimate.sum / row.n : 0;
    return `${label} n=${row.n}, mean ${mean.toFixed(2)}`;
  }
  const items = Object.entries(estimate.elementCounts)
    .filter(([, count]) => row.n > 0 && count / row.n >= 0.5)
    .map(([item]) => item)
    .sort();
  return `${label} n=${row.n}, items ${items.join('|') || '∅'}`;
}

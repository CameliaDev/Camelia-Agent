/**
 * Cold-start anchors (ARCH-COGNITION §4.4).
 *
 * The L-1 prior is not 0.5. It reuses quality, the failure count, and
 * `difficultyScore`. `basis` names those inputs. This function does not read
 * the backoff table and does not call a model.
 * @module
 */

import type { ObservableKind, PredictionValue, SituationSignature } from '@camelia/core';

import { difficultyScore } from '../routing/cheap-first.js';
import { clamp01 } from './score.js';

const FAILURE_MODES = [
  'path-hallucination',
  'zero-tool-calls',
  'context-exhaustion',
  'declared-but-ineffective',
  'abi-mismatch',
] as const;

export interface PriorContext {
  readonly signature: SituationSignature;
  /** ProviderCapabilities.quality, 0..1. */
  readonly quality: number;
  /** Workspace failure observations available at prediction time. Not a probability. */
  readonly historicalFailures: number;
  readonly weight: number;
  readonly fileCount: number;
  /** Paths the plan already named. A prior for touched-paths, not an observation. */
  readonly acceptancePaths: readonly string[];
  readonly failureModeCounts?: Readonly<Partial<Record<string, number>>>;
}

export interface ColdPrior {
  readonly value: PredictionValue;
  readonly confidence: number;
  readonly basis: string;
  readonly difficulty: number;
}

export function coldStartPrior(kind: ObservableKind, ctx: PriorContext): ColdPrior {
  const quality = clamp01(ctx.quality);
  const difficulty = difficultyScore({
    weight: ctx.weight,
    inDegree: ctx.signature.inDegree,
    fileCount: ctx.fileCount,
    historicalFailures: ctx.historicalFailures,
  });
  const failures = Math.max(0, Math.trunc(ctx.historicalFailures));
  switch (kind) {
    case 'verdict':
      return verdictPrior(quality, difficulty, failures);
    case 'tool-outcome':
      return toolOutcomePrior(quality, ctx.signature, failures);
    case 'tool-call-count':
      return {
        value: { kind: 'numeric', value: toolCountPrior(ctx.signature, difficulty), unit: 'count' },
        confidence: 0.25,
        basis: `prior: scope ${ctx.signature.scope}, difficulty ${difficulty.toFixed(2)}, granularity ${ctx.signature.capability}`,
        difficulty,
      };
    case 'duration-ms':
      return {
        value: { kind: 'numeric', value: durationPriorMs(ctx.signature, difficulty), unit: 'ms' },
        confidence: 0.25,
        basis: `prior: scope ${ctx.signature.scope}, difficulty ${difficulty.toFixed(2)}`,
        difficulty,
      };
    case 'cost-usd':
      return {
        value: { kind: 'numeric', value: Number((difficulty * 0.02).toFixed(4)), unit: 'usd' },
        confidence: 0.2,
        basis: `prior: difficulty ${difficulty.toFixed(2)} (no measured cost yet)`,
        difficulty,
      };
    case 'touched-paths': {
      const items = [...new Set(ctx.acceptancePaths.map((path) => path.replace(/\\/g, '/')))].sort();
      return {
        value: { kind: 'set', items },
        confidence: 0.3,
        basis: `prior: plan acceptance paths (${items.length})`,
        difficulty,
      };
    }
    case 'failure-mode':
      return failureModePrior(ctx.failureModeCounts ?? {}, failures);
    default:
      return verdictPrior(quality, difficulty, failures);
  }
}

function verdictPrior(quality: number, difficulty: number, failures: number): ColdPrior {
  const failurePush = Math.min(1, failures / 3) * 0.25;
  const difficultyPush = difficulty >= 0.5 ? 0.1 : 0;
  let pFail = clamp01((1 - quality) * 0.55 + failurePush + difficultyPush);
  const pUnknown = 0.05;
  if (pFail + pUnknown > 0.95) pFail = 0.95 - pUnknown;
  const pPass = 1 - pFail - pUnknown;
  return {
    value: { kind: 'categorical-multi', probs: { pass: pPass, fail: pFail, unknown: pUnknown } },
    confidence: clamp01(Math.max(pPass, pFail)),
    basis: `prior: quality ${quality.toFixed(2)}, difficulty ${difficulty.toFixed(2)}, ${failures} recorded failure(s)`,
    difficulty,
  };
}

function toolOutcomePrior(quality: number, signature: SituationSignature, failures: number): ColdPrior {
  // text-tool-calls models describe a call instead of returning one. The prior
  // is lower before any sample exists; capability is known now, not learned.
  const penalty = signature.capability === 'text-tool-calls' ? 0.2 : signature.capability === 'no-tools' ? 0.35 : 0;
  const pOk = clamp01(quality - penalty - Math.min(0.15, failures * 0.02));
  return {
    value: { kind: 'categorical', p: pOk, label: 'ok' },
    confidence: clamp01(Math.max(pOk, 1 - pOk)),
    basis: `prior: quality ${quality.toFixed(2)}, capability ${signature.capability}, ${failures} recorded failure(s)`,
    difficulty: 0,
  };
}

function failureModePrior(counts: Readonly<Partial<Record<string, number>>>, failures: number): ColdPrior {
  const raw = FAILURE_MODES.map((kind) => Math.max(0, counts[kind] ?? 0));
  const total = raw.reduce((sum, n) => sum + n, 0);
  const probs: Record<string, number> = {};
  if (total <= 0) {
    for (const kind of FAILURE_MODES) probs[kind] = 1 / FAILURE_MODES.length;
  } else {
    for (let i = 0; i < FAILURE_MODES.length; i += 1) probs[FAILURE_MODES[i]!] = (raw[i] ?? 0) / total;
  }
  return {
    value: { kind: 'categorical-multi', probs },
    confidence: total > 0 ? 0.4 : 0.2,
    basis: `prior: failure_modes counts (n=${total}), ${failures} recorded failure(s)`,
    difficulty: 0,
  };
}

/** Scope sets the base. Difficulty may add one call. Archetype is left for the table to learn. */
export function toolCountPrior(signature: SituationSignature, difficulty: number): number {
  const scopeBase =
    signature.scope === 'many-files' ? 6 : signature.scope === 'few-files' ? 3 : signature.scope === 'single-file' ? 1 : 1;
  return scopeBase + (difficulty >= 0.5 ? 1 : 0);
}

export function durationPriorMs(signature: SituationSignature, difficulty: number): number {
  const scopeBase =
    signature.scope === 'many-files' ? 8_000 : signature.scope === 'few-files' ? 3_000 : signature.scope === 'single-file' ? 1_200 : 900;
  return Math.round(scopeBase * (1 + difficulty));
}

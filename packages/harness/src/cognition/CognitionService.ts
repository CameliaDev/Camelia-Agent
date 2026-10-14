/**
 * CognitionPort implementation (ARCH-COGNITION Phase 3).
 *
 * Predicts from the backoff table, scores with the Phase 2 rules, and writes
 * `predictions` / `residuals` / `situation_stats`. No model call. A store
 * failure is logged and does not escape: the loop must keep running.
 * @module
 */

import { newId, type CognitionPort, type CompetenceQuery, type CompetenceReport, type LoggerPort, type Observable, type ObservedValue, type Prediction, type PredictionContext, type Residual, type SessionStore, type SituationSignature, type Uncertainty } from '@camelia/core';

import { BackoffTable, type LevelStat } from './BackoffTable.js';
import { backoffChain } from './signature.js';
import { coldStartPrior, type PriorContext } from './prior.js';
import {
  clamp01,
  contrastLine,
  decideSurprise,
  DEFAULT_MIN_LEVEL_SAMPLES,
  DEFAULT_MIN_SAMPLES,
  DEFAULT_SURPRISE_PERCENTILE,
  scoreValue,
} from './score.js';

export interface CognitionServiceOptions {
  readonly store: SessionStore;
  readonly minLevelSamples?: number;
  readonly minSamples?: number;
  readonly surprisePercentile?: number;
  readonly logger?: LoggerPort;
}

const PROBE_COST: Record<Observable['kind'], number> = {
  verdict: 2,
  'tool-outcome': 1,
  'tool-call-count': 0.5,
  'duration-ms': 0.5,
  'cost-usd': 1,
  'touched-paths': 1,
  'failure-mode': 1,
};

export class CognitionService implements CognitionPort {
  private readonly table: BackoffTable;
  private readonly minSamples: number;
  private readonly percentile: number;
  private readonly pending = new Map<string, OpenPrediction[]>();
  private loadOnce?: Promise<void>;

  constructor(private readonly options: CognitionServiceOptions) {
    this.table = new BackoffTable({
      minLevelSamples: options.minLevelSamples ?? DEFAULT_MIN_LEVEL_SAMPLES,
    });
    this.minSamples = options.minSamples ?? DEFAULT_MIN_SAMPLES;
    this.percentile = options.surprisePercentile ?? DEFAULT_SURPRISE_PERCENTILE;
  }

  async predict(
    subject: Observable,
    signature: SituationSignature,
    ctx: PredictionContext,
  ): Promise<Prediction | undefined> {
    try {
      await this.ensureLoaded();
      const priorCtx = await this.priorContext(signature, ctx);
      const prior = coldStartPrior(subject.kind, priorCtx);
      const hit = this.table.lookup(signature, subject.kind, prior.value, prior.basis, prior.confidence);
      const prediction: Prediction = {
        id: newId(),
        taskId: ctx.taskId,
        sessionId: ctx.sessionId,
        stepId: stepIdOf(subject, ctx),
        subject,
        signature,
        signatureKey: hit.signatureKey,
        value: hit.value,
        confidence: hit.confidence,
        source: hit.source,
        basis: hit.basis,
        level: hit.level,
        at: ctx.now,
      };
      this.enqueue(prediction, hit.n);
      await this.persistPrediction(prediction);
      return prediction;
    } catch (error) {
      this.options.logger?.debug('cognition predict failed', { error: String(error) });
      return undefined;
    }
  }

  async observe(
    subject: Observable,
    observed: ObservedValue,
    ctx: PredictionContext,
  ): Promise<Residual | undefined> {
    try {
      await this.ensureLoaded();
      const open = this.dequeue(subject);
      if (!open) return undefined;
      const { prediction, sampleCount } = open;
      const scored = scoreValue(prediction.value, observed);
      const decision = decideSurprise({
        score: scored.score,
        source: prediction.source,
        sampleCount,
        recentScores: this.table.residualScores(prediction.signatureKey, subject.kind),
        minSamples: this.minSamples,
        percentile: this.percentile,
      });
      if (prediction.source === 'empirical-backoff') {
        this.table.noteResidual(prediction.signatureKey, subject.kind, scored.score, prediction.confidence);
      }
      const unit = prediction.value.kind === 'numeric' ? prediction.value.unit : undefined;
      this.table.absorb(prediction.signature, subject.kind, observed, unit);
      const residual: Residual = {
        predictionId: prediction.id,
        taskId: ctx.taskId,
        signatureKey: prediction.signatureKey,
        observed,
        score: scored.score,
        rule: scored.rule,
        surprise: decision.surprise,
        threshold: decision.threshold,
        contrast: contrastLine(prediction.value, observed),
        at: ctx.now,
      };
      await this.persistResidual(residual);
      await this.persistChain(prediction.signature, subject.kind, ctx.now);
      return residual;
    } catch (error) {
      this.options.logger?.debug('cognition observe failed', { error: String(error) });
      return undefined;
    }
  }

  async competence(filter: CompetenceQuery): Promise<CompetenceReport> {
    await this.ensureLoaded();
    const key = filter.signatureKey ?? '*';
    const now = Date.now();
    let n = 0;
    let sumScore = 0;
    let sumScoreSq = 0;
    let sumConfidence = 0;
    for (const kind of PROBE_COST_KINDS) {
      const snap = this.table.snapshot(key, kind);
      if (!snap) continue;
      n += snap.n;
      sumScore += snap.sumScore;
      sumScoreSq += snap.sumScoreSq;
      sumConfidence += snap.sumConfidence;
    }
    const mean = n > 0 ? sumScore / n : 0;
    const variance = n > 0 ? Math.max(0, sumScoreSq / n - mean * mean) : 0;
    const meanConfidence = n > 0 ? sumConfidence / n : 0;
    return {
      signatureKey: key,
      n,
      meanResidual: mean,
      residualStdDev: Math.sqrt(variance),
      calibrationGap: meanConfidence - (1 - mean),
      from: filter.since ?? now,
      to: now,
    };
  }

  async mostUncertain(
    candidates: readonly Observable[],
    ctx: PredictionContext,
    limit: number,
  ): Promise<readonly Uncertainty[]> {
    await this.ensureLoaded();
    const ranked = candidates.map((subject) => {
      const snap = this.table.snapshot('*', subject.kind);
      const n = snap?.n ?? 0;
      const familiarity = 1 - n / (n + 10);
      return {
        signatureKey: '*',
        subject,
        entropy: clamp01(familiarity),
        probeCost: PROBE_COST[subject.kind],
      };
    });
    void ctx;
    return ranked
      .sort((a, b) => b.entropy / b.probeCost - a.entropy / a.probeCost)
      .slice(0, Math.max(0, limit));
  }

  private enqueue(prediction: Prediction, sampleCount: number): void {
    const key = pendingKey(prediction.subject);
    const queue = this.pending.get(key) ?? [];
    queue.push({ prediction, sampleCount });
    this.pending.set(key, queue);
  }

  private dequeue(subject: Observable): OpenPrediction | undefined {
    const key = pendingKey(subject);
    const queue = this.pending.get(key);
    if (!queue || queue.length === 0) return undefined;
    const next = queue.shift();
    if (queue.length === 0) this.pending.delete(key);
    return next;
  }

  private async priorContext(signature: SituationSignature, ctx: PredictionContext): Promise<PriorContext> {
    const acceptancePaths = acceptancePathsOf(ctx.step);
    let historicalFailures = 0;
    try {
      historicalFailures = await this.options.store.countFailureModes(ctx.workspace);
    } catch (error) {
      this.options.logger?.debug('cognition failure count unavailable', { error: String(error) });
    }
    return {
      signature,
      quality: ctx.capabilities.quality,
      historicalFailures,
      weight: ctx.step.weight,
      fileCount: Math.max(1, acceptancePaths.length),
      acceptancePaths,
    };
  }

  private async ensureLoaded(): Promise<void> {
    this.loadOnce ??= this.loadStats();
    await this.loadOnce;
  }

  private async loadStats(): Promise<void> {
    try {
      const stats = await this.options.store.listSituationStats();
      for (const stat of stats) {
        const level: LevelStat = {
          signatureKey: stat.signatureKey,
          n: stat.n,
          sumScore: stat.sumScore,
          sumScoreSq: stat.sumScoreSq,
          sumConfidence: stat.sumConfidence,
          estimate: stat.estimate,
        };
        this.table.restore(stat.subjectKind, level);
      }
    } catch (error) {
      this.options.logger?.debug('cognition stats not loaded', { error: String(error) });
    }
  }

  private async persistPrediction(prediction: Prediction): Promise<void> {
    try {
      await this.options.store.insertPrediction(prediction);
    } catch (error) {
      this.options.logger?.debug('cognition prediction not stored', { error: String(error) });
    }
  }

  private async persistResidual(residual: Residual): Promise<void> {
    try {
      await this.options.store.insertResidual(residual);
    } catch (error) {
      this.options.logger?.debug('cognition residual not stored', { error: String(error) });
    }
  }

  private async persistChain(signature: SituationSignature, kind: Observable['kind'], now: number): Promise<void> {
    for (const link of backoffChain(signature)) {
      const snap = this.table.snapshot(link.key, kind);
      if (!snap) continue;
      try {
        await this.options.store.upsertSituationStat({
          signatureKey: snap.signatureKey,
          subjectKind: kind,
          n: snap.n,
          sumScore: snap.sumScore,
          sumScoreSq: snap.sumScoreSq,
          sumConfidence: snap.sumConfidence,
          estimate: snap.estimate,
          updatedAt: now,
        });
      } catch (error) {
        this.options.logger?.debug('cognition stat not stored', { error: String(error) });
      }
    }
  }
}

interface OpenPrediction {
  readonly prediction: Prediction;
  readonly sampleCount: number;
}

const PROBE_COST_KINDS = Object.keys(PROBE_COST) as Observable['kind'][];

function pendingKey(subject: Observable): string {
  switch (subject.kind) {
    case 'verdict':
    case 'tool-call-count':
    case 'duration-ms':
    case 'touched-paths':
      return `${subject.kind}\0${subject.stepId}`;
    case 'tool-outcome':
      return `tool-outcome\0${subject.tool}`;
    case 'cost-usd':
      return `cost-usd\0${subject.taskId}`;
    case 'failure-mode':
      return `failure-mode\0${subject.workspace}`;
  }
}

function stepIdOf(subject: Observable, ctx: PredictionContext): string | undefined {
  switch (subject.kind) {
    case 'verdict':
    case 'tool-call-count':
    case 'duration-ms':
    case 'touched-paths':
      return subject.stepId;
    default:
      return ctx.stepId;
  }
}

export function acceptancePathsOf(step: { acceptance: readonly { params: { path?: unknown } }[] }): string[] {
  const paths: string[] = [];
  for (const point of step.acceptance) {
    const path = point.params.path;
    if (typeof path === 'string' && path.trim()) paths.push(path.replace(/\\/g, '/'));
  }
  return paths;
}

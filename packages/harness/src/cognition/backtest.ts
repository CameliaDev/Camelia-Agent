/**
 * Offline cognition backtest (ARCH-COGNITION §8.3, Phase 0).
 *
 * Replays a DomainEvent sequence, builds (signature, prediction, observation)
 * triples, and scores them with hierarchical backoff only. Nothing here changes
 * a plan, a tool call, or a model choice. Predictions are causal: the table
 * is updated only after the observation.
 *
 * Cost and failure-mode are scored only when the log actually contains an
 * observation. `routing.chosen.estimatedUsd` is an estimate, not an observation,
 * and is ignored.
 * @module
 */

import type { ObservableKind, ObservedValue, PredictionValue } from '@camelia/core';

import { BackoffTable, type BackoffHit } from './BackoffTable.js';
import { coldStartPrior, type PriorContext } from './prior.js';
import { capabilityClass, inDegreeOf, buildSignature } from './signature.js';
import {
  decideSurprise,
  DEFAULT_MIN_LEVEL_SAMPLES,
  DEFAULT_MIN_SAMPLES,
  DEFAULT_SURPRISE_PERCENTILE,
  DEFAULT_SURPRISE_WINDOW,
  scoreValue,
} from './score.js';
import type { CapabilityClass, SituationSignature } from '@camelia/core';

/** One stored or synthetic domain event. `seq` orders the replay. */
export interface ReplayEvent {
  readonly seq?: number;
  readonly sessionId?: string;
  readonly taskId?: string;
  readonly type: string;
  readonly payload: unknown;
  readonly traceId?: string;
  readonly ts: number;
}

export interface BacktestOptions {
  readonly minLevelSamples?: number;
  readonly minSamples?: number;
  readonly surprisePercentile?: number;
  readonly surpriseWindow?: number;
  /** Label written into the report. The caller says whether the log is real or simulated. */
  readonly sourceLabel?: string;
}

export interface LevelSummary {
  readonly level: number;
  readonly count: number;
  readonly meanResidual: number;
}

export interface KindSummary {
  readonly kind: string;
  readonly count: number;
  readonly meanResidual: number;
  /** L2+ mean on this kind, and the prior's mean on those same observations. */
  readonly l2PlusCount: number;
  readonly l2PlusMean: number;
  readonly priorMean: number;
  readonly delta: number;
}

export interface BacktestReport {
  readonly sourceLabel: string;
  readonly episodes: number;
  readonly steps: number;
  readonly stepsPredicted: number;
  /** Steps we could sign and predict, divided by steps that produced an observation. */
  readonly coverage: number;
  /** Share of scored predictions served by the table rather than the cold-start prior. */
  readonly empiricalCoverage: number;
  readonly predictionsScored: number;
  readonly byLevel: readonly LevelSummary[];
  readonly byKind: readonly KindSummary[];
  /** How many scored predictions each backoff level served. Level −1 is the prior. */
  readonly backoffDistribution: readonly { level: number; count: number }[];
  readonly l2Plus: { readonly count: number; readonly meanResidual: number };
  readonly priorOnL2Plus: { readonly count: number; readonly meanResidual: number };
  /** priorOnL2Plus.meanResidual − l2Plus.meanResidual. Positive means L2+ is better. */
  readonly delta: number;
  readonly gateThreshold: number;
  readonly gate: 'PASS' | 'FAIL';
  readonly surpriseCount: number;
  readonly priorSurpriseCount: number;
  readonly skippedSensors: readonly string[];
}

interface SessionCaps {
  capability: CapabilityClass;
  quality: number;
}

interface PlanStep {
  id: string;
  title: string;
  goal: string;
  weight: number;
  deps: string[];
  acceptancePaths: string[];
}

interface PendingTool {
  name: string;
  paths: string[];
  hit: BackoffHit;
  priorValue: PredictionValue;
}

interface OpenStep {
  taskId: string;
  sessionId: string;
  stepId: string;
  signature: SituationSignature;
  priorCtx: Omit<PriorContext, 'signature'>;
  startedAt: number;
  tools: number;
  paths: string[];
  toolDurationMs: number;
  pending: PendingTool | undefined;
  predictions: { kind: ObservableKind; hit: BackoffHit; priorValue: PredictionValue }[];
  verdict?: string;
  closed: boolean;
}

interface Acc {
  count: number;
  sum: number;
}

const GATE_THRESHOLD = 0.1;

export function runCognitionBacktest(events: readonly ReplayEvent[], options: BacktestOptions = {}): BacktestReport {
  const table = new BackoffTable({ minLevelSamples: options.minLevelSamples ?? DEFAULT_MIN_LEVEL_SAMPLES });
  const minSamples = options.minSamples ?? DEFAULT_MIN_SAMPLES;
  const surprisePercentile = options.surprisePercentile ?? DEFAULT_SURPRISE_PERCENTILE;
  const surpriseWindow = options.surpriseWindow ?? DEFAULT_SURPRISE_WINDOW;
  const ordered = [...events].sort((a, b) => (a.seq ?? a.ts) - (b.seq ?? b.ts) || a.ts - b.ts);

  const capsBySession = new Map<string, SessionCaps>();
  const plans = new Map<string, PlanStep[]>();
  const open = new Map<string, OpenStep>();
  const failsBySession = new Map<string, number>();
  const tasks = new Set<string>();
  let steps = 0;
  let stepsPredicted = 0;
  let scored = 0;
  let empiricalScored = 0;
  let surpriseCount = 0;
  let priorSurpriseCount = 0;
  const byLevel = new Map<number, Acc>();
  const byKindEmp = new Map<string, Acc>();
  const byKindL2 = new Map<string, Acc>();
  const byKindPrior = new Map<string, Acc>();
  const backoff = new Map<number, number>();
  const l2 = { count: 0, sum: 0 };
  const priorL2 = { count: 0, sum: 0 };

  const scoreHit = (
    step: OpenStep,
    kind: ObservableKind,
    hit: BackoffHit,
    priorValue: PredictionValue,
    observed: ObservedValue,
  ): void => {
    const empirical = scoreValue(hit.value, observed);
    const priorScored = scoreValue(priorValue, observed);
    const history = table.residualScores(hit.signatureKey, kind);
    const decision = decideSurprise({
      score: empirical.score,
      source: hit.source,
      sampleCount: hit.n,
      recentScores: history,
      minSamples,
      percentile: surprisePercentile,
      window: surpriseWindow,
    });
    if (decision.surprise) surpriseCount += 1;
    if (hit.source === 'prior' && decision.surprise) priorSurpriseCount += 1;
    if (hit.source === 'empirical-backoff') {
      table.noteResidual(hit.signatureKey, kind, empirical.score, hit.confidence);
      empiricalScored += 1;
    }
    const unit = hit.value.kind === 'numeric' ? hit.value.unit : observed.kind === 'numeric' ? undefined : undefined;
    table.absorb(step.signature, kind, observed, unit);
    add(byLevel, hit.level, empirical.score);
    add(byKindEmp, kind, empirical.score);
    backoff.set(hit.level, (backoff.get(hit.level) ?? 0) + 1);
    if (hit.level >= 2) {
      l2.count += 1;
      l2.sum += empirical.score;
      priorL2.count += 1;
      priorL2.sum += priorScored.score;
      add(byKindL2, kind, empirical.score);
      add(byKindPrior, kind, priorScored.score);
    }
    scored += 1;
  };

  for (const event of ordered) {
    const payload = asRecord(event.payload);
    if (!payload) continue;
    const sessionId = event.sessionId ?? 'session';
    if (event.taskId) tasks.add(event.taskId);

    if (event.type === 'provider.capabilities') {
      const capabilities = asRecord(payload.capabilities);
      if (!capabilities) continue;
      capsBySession.set(sessionId, {
        capability: capabilityClass({
          supportsTools: capabilities.supportsTools === true,
          textToolCalls: capabilities.textToolCalls === true,
        }),
        quality: numberOr(capabilities.quality, 0.5),
      });
      continue;
    }

    if (event.type === 'plan.ready' || event.type === 'plan.revised') {
      const plan = asRecord(payload.plan);
      const rawSteps = plan?.steps;
      if (!event.taskId || !Array.isArray(rawSteps)) continue;
      plans.set(event.taskId, rawSteps.map(readPlanStep).filter((step): step is PlanStep => step !== undefined));
      continue;
    }

    if (event.type === 'step.started') {
      const started = openStep(event, payload, plans, capsBySession, failsBySession);
      if (!started) continue;
      open.set(started.stepId, started);
      const predict = (kind: ObservableKind): void => {
        const prior = coldStartPrior(kind, { ...started.priorCtx, signature: started.signature });
        const hit = table.lookup(started.signature, kind, prior.value, prior.basis, prior.confidence);
        started.predictions.push({ kind, hit, priorValue: prior.value });
      };
      predict('verdict');
      predict('tool-call-count');
      predict('duration-ms');
      predict('touched-paths');
      continue;
    }

    const step = findOpen(open, event.taskId, payload);
    if (!step) continue;

    if (event.type === 'tool.requested') {
      const call = asRecord(payload.call);
      if (!call || step.pending) continue;
      const name = typeof call.name === 'string' ? call.name : 'tool';
      const paths = pathsOf(call.input);
      const prior = coldStartPrior('tool-outcome', { ...step.priorCtx, signature: step.signature });
      const hit = table.lookup(step.signature, 'tool-outcome', prior.value, prior.basis, prior.confidence);
      step.pending = { name, paths, hit, priorValue: prior.value };
      continue;
    }

    if (event.type === 'tool.finished' || event.type === 'tool.failed') {
      const pending = step.pending;
      const call = asRecord(payload.call);
      const status: 'ok' | 'error' =
        event.type === 'tool.failed' || call?.status === 'error' ? 'error' : 'ok';
      const paths = pending?.paths ?? pathsOf(call?.input);
      for (const path of paths) if (!step.paths.includes(path)) step.paths.push(path);
      const duration = call ? numberOr(call.durationMs, 0) : 0;
      if (duration > 0) step.toolDurationMs += duration;
      step.tools += 1;
      if (pending) {
        scoreHit(step, 'tool-outcome', pending.hit, pending.priorValue, { kind: 'categorical', label: status });
        step.pending = undefined;
      }
      continue;
    }

    if (event.type === 'verify.result') {
      const verdict = asRecord(payload.verdict);
      const status = verdict?.status;
      if (status !== 'pass' && status !== 'fail' && status !== 'unknown') continue;
      step.verdict = status;
      const slot = step.predictions.find((item) => item.kind === 'verdict');
      if (slot) scoreHit(step, 'verdict', slot.hit, slot.priorValue, { kind: 'categorical', label: status });
      if (status === 'fail') failsBySession.set(step.sessionId, (failsBySession.get(step.sessionId) ?? 0) + 1);
      continue;
    }

    if (event.type === 'step.completed' || event.type === 'step.failed') {
      if (step.closed) continue;
      step.closed = true;
      steps += 1;
      if (step.predictions.length > 0) stepsPredicted += 1;
      const result = asRecord(payload.result);
      const artifacts = Array.isArray(result?.artifacts) ? result.artifacts : [];
      for (const artifact of artifacts) {
        const row = asRecord(artifact);
        if (typeof row?.path === 'string') {
          const path = row.path.replace(/\\/g, '/');
          if (!step.paths.includes(path)) step.paths.push(path);
        }
      }
      const countSlot = step.predictions.find((item) => item.kind === 'tool-call-count');
      if (countSlot) {
        scoreHit(step, 'tool-call-count', countSlot.hit, countSlot.priorValue, { kind: 'numeric', value: step.tools });
      }
      const durationSlot = step.predictions.find((item) => item.kind === 'duration-ms');
      if (durationSlot) {
        const wall = Math.max(0, event.ts - step.startedAt);
        const duration = step.toolDurationMs > 0 ? step.toolDurationMs : wall;
        scoreHit(step, 'duration-ms', durationSlot.hit, durationSlot.priorValue, { kind: 'numeric', value: duration });
      }
      const pathSlot = step.predictions.find((item) => item.kind === 'touched-paths');
      if (pathSlot) {
        scoreHit(step, 'touched-paths', pathSlot.hit, pathSlot.priorValue, { kind: 'set', items: step.paths });
      }
      open.delete(step.stepId);
    }
  }

  const l2Mean = l2.count > 0 ? l2.sum / l2.count : 0;
  const priorMean = priorL2.count > 0 ? priorL2.sum / priorL2.count : 0;
  const delta = priorMean - l2Mean;
  const gate: 'PASS' | 'FAIL' = l2.count > 0 && delta >= GATE_THRESHOLD ? 'PASS' : 'FAIL';
  const kinds = [...byKindEmp.keys()].sort();

  return {
    sourceLabel: options.sourceLabel ?? 'events',
    episodes: tasks.size,
    steps,
    stepsPredicted,
    coverage: steps === 0 ? 0 : stepsPredicted / steps,
    empiricalCoverage: scored === 0 ? 0 : empiricalScored / scored,
    predictionsScored: scored,
    byLevel: [...byLevel.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([level, acc]) => ({ level, count: acc.count, meanResidual: acc.sum / acc.count })),
    byKind: kinds.map((kind) => {
      const all = byKindEmp.get(kind)!;
      const spec = byKindL2.get(kind) ?? { count: 0, sum: 0 };
      const base = byKindPrior.get(kind) ?? { count: 0, sum: 0 };
      const specMean = spec.count > 0 ? spec.sum / spec.count : 0;
      const baseMean = base.count > 0 ? base.sum / base.count : 0;
      return {
        kind,
        count: all.count,
        meanResidual: all.sum / all.count,
        l2PlusCount: spec.count,
        l2PlusMean: specMean,
        priorMean: baseMean,
        delta: baseMean - specMean,
      };
    }),
    backoffDistribution: [...backoff.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([level, count]) => ({ level, count })),
    l2Plus: { count: l2.count, meanResidual: l2Mean },
    priorOnL2Plus: { count: priorL2.count, meanResidual: priorMean },
    delta,
    gateThreshold: GATE_THRESHOLD,
    gate,
    surpriseCount,
    priorSurpriseCount,
    skippedSensors: ['cost-usd', 'failure-mode'],
  };
}

export function formatBacktestReport(report: BacktestReport): string {
  const levelRows = report.byLevel
    .map((row) => `| ${levelLabel(row.level)} | ${row.count} | ${row.meanResidual.toFixed(4)} |`)
    .join('\n');
  const kindRows = report.byKind
    .map(
      (row) =>
        `| ${row.kind} | ${row.count} | ${row.meanResidual.toFixed(4)} | ${row.l2PlusCount} | ${row.l2PlusMean.toFixed(4)} | ${row.priorMean.toFixed(4)} | ${row.delta.toFixed(4)} |`,
    )
    .join('\n');
  const dist = report.backoffDistribution
    .map((row) => `| ${levelLabel(row.level)} | ${row.count} |`)
    .join('\n');
  const weakKinds = report.byKind.filter((row) => row.l2PlusCount > 0 && row.delta < report.gateThreshold);
  const weakNote =
    weakKinds.length === 0
      ? ''
      : `\n\nPooled gate aside, these observables do not clear ${report.gateThreshold.toFixed(1)} on their own: ${weakKinds
          .map((row) => `${row.kind} Δ=${row.delta.toFixed(4)}`)
          .join(', ')}.`;
  const gateNote =
    report.gate === 'PASS'
      ? `L2+ mean residual is at least 0.1 below the L-1 prior on the same observations. Phase 3 (wiring \`AgentLoop\`) is allowed by this gate. This change set does not wire it.${weakNote}`
      : `L2+ mean residual is not at least 0.1 below the L-1 prior. The signature does not yet carry enough information on this log. Redesign the signature before wiring \`AgentLoop\`. Phase 3/4 stay unwired.${weakNote}`;
  return `# Cognition Phase 0 backtest

Source: ${report.sourceLabel}

The replay builds (signature, prediction, observation) triples with §4.3 hierarchical backoff only. No plan, tool, or model choice is changed. \`routing.chosen.estimatedUsd\` is not treated as a cost observation. Sensors with no event in this log are listed below and are not scored.

## Gate

| | |
| --- | --- |
| L2+ predictions | ${report.l2Plus.count} |
| L2+ mean residual | ${report.l2Plus.meanResidual.toFixed(4)} |
| L-1 prior mean on the same observations | ${report.priorOnL2Plus.meanResidual.toFixed(4)} |
| delta (prior − L2+) | ${report.delta.toFixed(4)} |
| threshold | ${report.gateThreshold.toFixed(1)} |
| **gate** | **${report.gate}** |

${gateNote}

Prior predictions with \`surprise=true\`: ${report.priorSurpriseCount}. Total surprises: ${report.surpriseCount}.

## Coverage

| | |
| --- | --- |
| episodes (task ids) | ${report.episodes} |
| steps with an observation | ${report.steps} |
| steps predicted | ${report.stepsPredicted} |
| step coverage | ${report.coverage.toFixed(4)} |
| scored predictions | ${report.predictionsScored} |
| empirical share of scored predictions | ${report.empiricalCoverage.toFixed(4)} |
| sensors with no observation | ${report.skippedSensors.join(', ') || 'none'} |

Step coverage is "how many observed steps could be signed and predicted". The empirical share is how many of those predictions had left the cold-start prior.

## Mean residual by backoff level

| level | n | mean residual |
| --- | --- | --- |
${levelRows || '| — | 0 | — |'}

## Mean residual by observable

| kind | n | mean | L2+ n | L2+ mean | prior mean | delta |
| --- | --- | --- | --- | --- | --- | --- |
${kindRows || '| — | 0 | — | 0 | — | — | — |'}

## Backoff level distribution (scored predictions)

| level | n |
| --- | --- |
${dist || '| — | 0 |'}
`;
}

function levelLabel(level: number): string {
  return level < 0 ? 'L-1 prior' : `L${level}`;
}

function add(map: Map<number, Acc>, key: number, score: number): void;
function add(map: Map<string, Acc>, key: string, score: number): void;
function add(map: Map<number | string, Acc>, key: number | string, score: number): void {
  const acc = map.get(key) ?? { count: 0, sum: 0 };
  acc.count += 1;
  acc.sum += score;
  map.set(key, acc);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  return undefined;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function pathsOf(input: unknown): string[] {
  const record = asRecord(input);
  if (!record) return [];
  const out: string[] = [];
  for (const key of ['path', 'file', 'filePath']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) out.push(value.replace(/\\/g, '/'));
  }
  return out;
}

function readPlanStep(value: unknown): PlanStep | undefined {
  const row = asRecord(value);
  if (!row || typeof row.id !== 'string') return undefined;
  const acceptance = Array.isArray(row.acceptance) ? row.acceptance : [];
  const acceptancePaths: string[] = [];
  for (const point of acceptance) {
    const params = asRecord(asRecord(point)?.params);
    if (typeof params?.path === 'string') acceptancePaths.push(params.path.replace(/\\/g, '/'));
  }
  const deps = Array.isArray(row.deps) ? row.deps.filter((dep): dep is string => typeof dep === 'string') : [];
  return {
    id: row.id,
    title: typeof row.title === 'string' ? row.title : '',
    goal: typeof row.goal === 'string' ? row.goal : '',
    weight: numberOr(row.weight, 1),
    deps,
    acceptancePaths,
  };
}

function openStep(
  event: ReplayEvent,
  payload: Record<string, unknown>,
  plans: Map<string, PlanStep[]>,
  capsBySession: Map<string, SessionCaps>,
  failsBySession: Map<string, number>,
): OpenStep | undefined {
  const raw = asRecord(payload.step);
  if (!raw || typeof raw.id !== 'string' || !event.taskId) return undefined;
  const sessionId = event.sessionId ?? 'session';
  const planSteps = plans.get(event.taskId) ?? [];
  const fromPlan = planSteps.find((step) => step.id === raw.id) ?? readPlanStep(raw);
  if (!fromPlan) return undefined;
  const caps = capsBySession.get(sessionId) ?? { capability: 'no-tools' as const, quality: 0.3 };
  const siblings = planSteps.length > 0 ? planSteps : [fromPlan];
  const signature = buildSignature({
    title: fromPlan.title,
    goal: fromPlan.goal,
    acceptancePaths: fromPlan.acceptancePaths,
    inDegree: inDegreeOf(fromPlan.id, siblings),
    capability: caps.capability,
  });
  const failures = failsBySession.get(sessionId) ?? 0;
  return {
    taskId: event.taskId,
    sessionId,
    stepId: fromPlan.id,
    signature,
    priorCtx: {
      quality: caps.quality,
      historicalFailures: failures,
      weight: fromPlan.weight,
      fileCount: Math.max(fromPlan.acceptancePaths.length, signature.scope === 'few-files' ? 2 : signature.scope === 'many-files' ? 4 : signature.scope === 'single-file' ? 1 : 0),
      acceptancePaths: fromPlan.acceptancePaths,
    },
    startedAt: event.ts,
    tools: 0,
    paths: [],
    toolDurationMs: 0,
    pending: undefined,
    predictions: [],
    closed: false,
  };
}

function findOpen(open: Map<string, OpenStep>, taskId: string | undefined, payload: Record<string, unknown>): OpenStep | undefined {
  const verdict = asRecord(payload.verdict);
  const call = asRecord(payload.call);
  const step = asRecord(payload.step);
  const stepId =
    (typeof verdict?.stepId === 'string' && verdict.stepId) ||
    (typeof call?.stepId === 'string' && call.stepId) ||
    (typeof step?.id === 'string' && step.id) ||
    '';
  if (stepId && open.has(stepId)) return open.get(stepId);
  if (!taskId) return undefined;
  for (const candidate of open.values()) if (candidate.taskId === taskId) return candidate;
  return undefined;
}

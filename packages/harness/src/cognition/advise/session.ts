/**
 * Advise session — one process-level state for the Phase 4 path.
 *
 * `advise` builds a ticket and stops. It does not execute the action. A
 * rejected translate, or a rollback check that fails on an authorized ticket,
 * does not write a SkillRecord. A skill is written only when the hard-gate
 * memory guard allows it (test, type, or sandbox, and the outcome succeeded).
 * Authorized non-exploration outcomes still update Router B samples, including
 * failures and soft gates. Exploration failures stay out of the skill table,
 * the structured-failure streak, and the Router B samples.
 * @module
 */

import type {
  AdviceTicket,
  AdviseErrorClass,
  AdviseMetricsSnapshot,
  EnvironmentStatus,
  HumanGateLevel,
  RollbackType,
  SkillRecord,
  StructuredResidual,
} from '@camelia/core';

import { mayWriteMemoryFromVerifier } from '../memory-write-gate.js';
import { parseTranslateActionV1 } from '../translate-schema.js';
import { criticalDiff } from './diff.js';
import { defaultHeuristicTable } from './default-table.js';
import { checkEnvironment, EnvironmentLedger, type EnvironmentProbeOptions } from './environment.js';
import { canExplore, consumeExplore, dayKey, emptyBudget, noteDemand, type BudgetState } from './exploration.js';
import { createGate, explorationAllowed, manualLower, manualRaise, noteStructuredMismatch, noteSuccess, requiresHuman, type GateState } from './gate.js';
import type { HeuristicTable } from './heuristic.js';
import { parseHeuristicTable } from './heuristic.js';
import { bumpResidual, emptyMetrics, noteSkillWritten, snapshotMetrics, type MetricsState } from './metrics.js';
import { hardGateOf, sealErrorClass, softGateOf } from './error-class.js';
import { validateRollback, type RollbackEvidence } from './rollback.js';
import { routeA, routeB, type ActionSample } from './router.js';
import { translate, type TranslateContext } from './translate.js';

const EMPTY_EVIDENCE: RollbackEvidence = {
  gitStashes: [],
  readableFiles: [],
  dockerSnapshots: [],
  openTransactions: [],
};

export interface AdviseInput {
  readonly now: number;
  readonly errorClass: string;
  readonly verifierId: string;
  readonly expected: Readonly<Record<string, unknown>>;
  readonly actual: Readonly<Record<string, unknown>>;
  readonly signature: readonly string[];
  readonly lastOutcome: 'success' | 'failure';
  readonly environmentHint?: EnvironmentStatus;
  readonly probe?: EnvironmentProbeOptions['probe'];
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly rollback?: { type: RollbackType; id: string };
  readonly evidence?: RollbackEvidence;
}

export interface AdviseOutcome {
  readonly ticket: AdviceTicket;
  readonly metrics: AdviseMetricsSnapshot;
  readonly residual: StructuredResidual;
}

export interface CommitInput {
  readonly ticketId: string;
  readonly success: boolean;
  readonly explorationFailed?: boolean;
  readonly now: number;
  readonly signatureKey: string;
  readonly memoryId?: string;
}

export class AdviseSession {
  private gate: GateState;
  private budget: BudgetState;
  private readonly env = new EnvironmentLedger();
  private metrics: MetricsState;
  private table: HeuristicTable;
  private samples: ActionSample[] = [];
  private seq = 0;
  private readonly tickets = new Map<string, AdviceTicket>();

  constructor(options: { now?: number; gate?: HumanGateLevel; table?: HeuristicTable; budget?: number } = {}) {
    const now = options.now ?? 0;
    this.gate = createGate(options.gate ?? 'L2');
    this.budget = emptyBudget(now, options.budget);
    this.metrics = emptyMetrics(now);
    this.table = options.table ?? defaultHeuristicTable();
  }

  replaceTable(text: string): { ok: true; version: string } | { ok: false; reason: string } {
    const parsed = parseHeuristicTable(text);
    if (!parsed.ok) return parsed;
    this.table = parsed.table;
    return { ok: true, version: parsed.table.heuristic_table_version };
  }

  manualRaise(): AdviseMetricsSnapshot {
    this.gate = manualRaise(this.gate);
    return this.metricsSnapshot();
  }

  manualLower(): AdviseMetricsSnapshot {
    this.gate = manualLower(this.gate);
    return this.metricsSnapshot();
  }

  noteSuccess(now: number): AdviseMetricsSnapshot {
    this.gate = noteSuccess(this.gate).state;
    const day = dayKey(now);
    if (day !== this.metrics.skillDay) this.metrics = { ...this.metrics, skillDay: day, skillsToday: 0 };
    return this.metricsSnapshot();
  }

  /** Record a human decision on a presented gate. Passes move the health rate. */
  noteHumanDecision(pass: boolean): AdviseMetricsSnapshot {
    if (pass) this.metrics = { ...this.metrics, gatePasses: this.metrics.gatePasses + 1 };
    return this.metricsSnapshot();
  }

  metricsSnapshot(): AdviseMetricsSnapshot {
    return snapshotMetrics(this.metrics, this.gate);
  }

  hotEnvironmentLogs(now: number) {
    return this.env.hotLogs(now);
  }

  archivedEnvironmentLogs(): number {
    return this.env.archived;
  }

  async advise(input: AdviseInput): Promise<AdviseOutcome> {
    const errorClass = sealErrorClass(input.errorClass);
    const environment = await this.resolveEnvironment(errorClass, input);
    const diff = criticalDiff(input.expected, input.actual);
    const residual: StructuredResidual = {
      verifierId: input.verifierId,
      errorClass,
      expected: input.expected,
      actual: input.actual,
      diff,
      environment: environment.status,
      hardGate: hardGateOf(errorClass),
      softGate: softGateOf(errorClass),
      at: input.now,
    };
    if (!diff.equal) this.metrics = bumpResidual(this.metrics, errorClass);
    this.budget = noteDemand(this.budget, errorClass, { unknown: environment.status === 'UNKNOWN', unequal: !diff.equal }, input.now);

    const routed = routeA({ errorClass, environment: environment.status, table: this.table });
    this.metrics = { ...this.metrics, routerHitsA: this.metrics.routerHitsA + 1 };
    const ranked = routeB({
      errorClass,
      candidates: routed.candidates,
      samples: this.samples,
      currentVersion: this.table.heuristic_table_version,
    });
    if (ranked.ranked) this.metrics = { ...this.metrics, routerHitsB: this.metrics.routerHitsB + 1 };

    const conflict = ranked.ranked && ranked.order[0] !== routed.candidates[0];
    const forced =
      conflict ||
      routed.source === 'unknown-fallback' ||
      routed.source === 'environment-unknown-batch' ||
      environment.status === 'UNKNOWN';
    const human = requiresHuman(this.gate.level, forced);

    let explored = false;
    let chosen = ranked.order[0];
    if (chosen && explorationAllowed(this.gate.level, human) && ranked.order.length > 1 && canExplore(this.budget, errorClass, input.now)) {
      chosen = ranked.order[1];
      explored = true;
      this.budget = consumeExplore(this.budget, errorClass, input.now);
    }

    const mismatch = noteStructuredMismatch(this.gate, input.verifierId, errorClass, !diff.equal);
    this.gate = mismatch.state;

    const id = `advise-${++this.seq}`;
    const base = {
      id,
      errorClass,
      verifierId: input.verifierId,
      environment: environment.status,
      environmentDegraded: environment.degraded,
      batchedUnknown: environment.status === 'UNKNOWN',
      environmentAttempts: environment.attempts,
      candidates: routed.candidates,
      routerSource: routed.source,
      heuristicTableVersion: routed.heuristicTableVersion,
      ranked: ranked.ranked,
      rankOrder: ranked.order,
      conflict,
      explored,
      gate: this.gate.level,
      gateMode: this.gate.mode,
      diffEqual: diff.equal,
      skillWritten: false as const,
    };

    if (!chosen) {
      return this.finish(residual, { ...base, disposition: 'rejected', rejectReason: 'no-candidate' });
    }

    const context: TranslateContext = {
      errorClass,
      verifierId: input.verifierId,
      action_id: chosen,
      signature: input.signature,
      lastOutcome: input.lastOutcome,
    };
    const confidence = ranked.topScore === null ? 0.5 : clamp01(ranked.topScore);
    const rollback = input.rollback ?? { type: 'file_backup' as const, id: '' };
    this.metrics = { ...this.metrics, translateAttempts: this.metrics.translateAttempts + 1 };
    const translated = translate({
      context,
      confidence,
      rollback,
      humanGateLevel: this.gate.level,
    });
    if (!translated.ok) {
      this.metrics = { ...this.metrics, translateRejects: this.metrics.translateRejects + 1 };
      return this.finish(residual, { ...base, disposition: 'rejected', rejectReason: translated.reason, actionId: chosen });
    }

    // Shape authority from stage 22. No probes here: a missing probe would
    // pass the stub, and existence is checked only after the human gate.
    const schema = parseTranslateActionV1(translated.value);
    if (!schema.ok) {
      this.metrics = { ...this.metrics, translateRejects: this.metrics.translateRejects + 1 };
      return this.finish(residual, {
        ...base,
        disposition: 'rejected',
        rejectReason: schema.code,
        actionId: chosen,
        translated: translated.value,
      });
    }

    if (human) {
      this.metrics = { ...this.metrics, gatePresentations: this.metrics.gatePresentations + 1 };
      return this.finish(residual, {
        ...base,
        disposition: 'pending_human',
        actionId: chosen,
        translated: translated.value,
      });
    }

    const checked = validateRollback(translated.value.rollback_point, input.evidence ?? EMPTY_EVIDENCE);
    if (!checked.ok) {
      return this.finish(residual, {
        ...base,
        disposition: 'rejected',
        rejectReason: checked.reason,
        actionId: chosen,
        translated: translated.value,
      });
    }
    return this.finish(residual, {
      ...base,
      disposition: 'authorized',
      actionId: chosen,
      translated: translated.value,
    });
  }

  /**
   * Record the outcome of an authorized ticket. Rejected tickets and
   * exploration failures do not write a SkillRecord.
   */
  commitOutcome(input: CommitInput): { skill?: SkillRecord; metrics: AdviseMetricsSnapshot } {
    const ticket = this.tickets.get(input.ticketId);
    if (!ticket || ticket.disposition === 'rejected' || !ticket.actionId) return { metrics: this.metricsSnapshot() };
    if (input.explorationFailed) return { metrics: this.metricsSnapshot() };
    if (ticket.disposition !== 'authorized') return { metrics: this.metricsSnapshot() };

    const version = ticket.heuristicTableVersion;
    const existing = this.samples.find(
      (sample) =>
        sample.errorClass === ticket.errorClass &&
        sample.actionId === ticket.actionId &&
        sample.heuristicTableVersion === version,
    );
    const attempts = (existing?.attempts ?? 0) + 1;
    const successes = (existing?.successes ?? 0) + (input.success ? 1 : 0);
    const nextSample: ActionSample = {
      errorClass: ticket.errorClass,
      actionId: ticket.actionId,
      heuristicTableVersion: version,
      attempts,
      successes,
    };
    this.samples = existing
      ? this.samples.map((sample) => (sample === existing ? nextSample : sample))
      : [...this.samples, nextSample];
    if (input.success) this.gate = noteSuccess(this.gate).state;
    const hard = hardGateOf(ticket.errorClass);
    const memory = mayWriteMemoryFromVerifier({
      hardGatePassed: hard !== null && input.success,
      softGateOnly: softGateOf(ticket.errorClass) !== null,
    });
    if (!memory.allow) return { metrics: this.metricsSnapshot() };
    const meanResidual = attempts > 0 ? (attempts - successes) / attempts : 0;
    const skill: SkillRecord = {
      memoryId: input.memoryId ?? `skill:${ticket.errorClass}:${ticket.actionId}:${version}`,
      steps: [ticket.actionId],
      signatureKey: input.signatureKey,
      attempts,
      successes,
      meanResidual,
      lastAttemptAt: input.now,
      heuristicTableVersion: version,
    };
    this.metrics = noteSkillWritten(this.metrics, input.now);
    this.tickets.set(ticket.id, { ...ticket, skillWritten: true });
    return { skill, metrics: this.metricsSnapshot() };
  }

  private finish(residual: StructuredResidual, ticket: AdviceTicket): AdviseOutcome {
    this.tickets.set(ticket.id, ticket);
    return { ticket, residual, metrics: this.metricsSnapshot() };
  }

  private async resolveEnvironment(
    errorClass: AdviseErrorClass,
    input: AdviseInput,
  ): Promise<{ status: EnvironmentStatus; degraded: boolean; attempts: number }> {
    if (!input.probe) {
      const hinted = input.environmentHint ?? 'OK';
      const raw = hinted === 'UNKNOWN' ? 'UNKNOWN' : hinted;
      const noted = this.env.note(errorClass, raw, input.now);
      this.env.push({
        at: input.now,
        errorClass,
        status: raw,
        attempt: 1,
        timedOut: raw === 'UNKNOWN',
        note: raw === 'OK' ? 'ok' : raw === 'FAIL' ? 'fail' : 'timeout',
      });
      return { status: noted.effective, degraded: noted.degraded, attempts: 1 };
    }
    const checked = await checkEnvironment({
      errorClass,
      probe: input.probe,
      timeoutMs: input.timeoutMs ?? 20,
      maxRetries: input.maxRetries ?? 2,
      now: () => input.now,
      ledger: this.env,
      sleep: input.sleep ?? (async () => {}),
    });
    return { status: checked.status, degraded: checked.degraded, attempts: checked.attempts };
  }
}

export function createAdviseSession(options?: ConstructorParameters<typeof AdviseSession>[0]): AdviseSession {
  return new AdviseSession(options);
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * Agent main loop (whitepaper §3.1).
 *
 * Drives the explicit lifecycle `planning → executing → verifying → delivering →
 * reflecting` for one task. Every transition is a real state-machine edge and
 * every observable fact is emitted on the bus, so the loop is interruptible,
 * resumable, auditable and projectable to a UI.
 *
 * Why not a `while(true)` loop: a hidden loop cannot be paused, resumed or
 * explained. The state machine is the contract (whitepaper §2.4).
 * @module
 */

import type {
  Artifact,
  Checkpoint,
  ClarifiedIntent,
  FsManifest,
  Id,
  MemoryItem,
  Plan,
  ModelInfo,
  Step,
  SubAgentReport,
  TaskStatus,
  Verdict,
} from '@camelia/core';
import { TaskStateMachine, estimateTokens, newId, phaseOf, shortId } from '@camelia/core';

import type { WorkspaceJournal } from '../checkpoint/WorkspaceJournal.js';
import type { ContextManager } from '../context/ContextManager.js';
import type { RunContext } from '../context/RunContext.js';
import { runMeta } from '../context/RunContext.js';
import type { HarnessConfig } from '../config.js';
import type { Executor } from '../execution/Executor.js';
import type { MemoryService } from '../memory/MemoryService.js';
import type { ModelGateway } from '../model/ModelGateway.js';
import type { Planner } from '../planning/Planner.js';
import type { PlanGate } from '../planning/PlanGate.js';
import { applyPlanEdits } from '../planning/plan-edits.js';
import { PathEnumError } from '../planning/paths.js';
import { fallbackPlan, topologicalOrder } from '../planning/plan-utils.js';
import { difficultyScore, estimateUsd, modelForAttempt } from '../routing/cheap-first.js';
import type { DriftDetector } from '../reliability/DriftDetector.js';
import type { LoopDetector } from '../reliability/LoopDetector.js';
import type { ErrorRecovery } from '../recovery/ErrorRecovery.js';
import {
  selfReviewConcerns,
  type PlanSelfReview,
  type SelfReviewDecisionPoint,
  type SelfReviewResult,
} from '../selfreview/PlanSelfReview.js';
import type { SubAgentOrchestrator, SubAgentSpec } from '../subagent/SubAgentOrchestrator.js';
import { TEAM_COORDINATOR_SYSTEM } from '../team/plan.js';
import { TeamOrchestrator } from '../team/TeamOrchestrator.js';
import type { Verifier } from '../verification/Verifier.js';
import { writeRunRecord } from '../replay/run-record.js';
import path from 'node:path';

export interface AgentLoopDeps {
  gateway: ModelGateway;
  planner: Planner;
  executor: Executor;
  verifier: Verifier;
  recovery: ErrorRecovery;
  context: ContextManager;
  journal: WorkspaceJournal;
  loop: LoopDetector;
  drift: DriftDetector;
  subAgents?: SubAgentOrchestrator;
  config: HarnessConfig;
  /** Plan self-review — "think before acting" (Iteration 20). */
  selfReview: PlanSelfReview;
  /** Memory service — lifecycle, value-driven forgetting, reactivation (Iteration 20). */
  memory: MemoryService;
  /** Present when a person can approve the plan. Absent in in-process tests. */
  planGate?: PlanGate;
}

export interface RunOptions {
  /** Reuse a persisted plan instead of re-planning (resume path). */
  plan?: Plan;
  /** Skip steps before this index (resume path). */
  startStepIdx?: number;
}

export interface TaskOutcome {
  taskId: Id;
  status: 'done' | 'failed' | 'paused' | 'cancelled';
  summary: string;
  artifacts: Artifact[];
  verdicts: Verdict[];
  stepsCompleted: number;
  stepsTotal: number;
  /** Steps that finished but could not be objectively verified. */
  unverifiedSteps: number;
  iterations: number;
  tokensUsed: number;
  durationMs: number;
  /** Present when the task paused — where a resume would continue from. */
  resumeStepIdx?: number;
  /** Reason for a failure/cancellation. */
  reason?: string;
}

export class AgentLoop {
  private state = new TaskStateMachine('received');
  private pauseRequested = false;
  private cancelReason?: string;
  private pendingIntervention?: string;
  private iterations = 0;
  /**
   * Memories injected into this task (Iteration 21 — outcome feedback loop).
   *
   * Reset per task; every item surfaced by `injectMemories` is tracked so the
   * task outcome can strengthen (markCorrect) or downgrade (markIncorrect) the
   * procedural recipes that influenced the run.
   */
  private recalledMemoryIds = new Set<string>();
  /**
   * Tool-call records from every executed step (Iteration 24 — run record).
   * Sub-agent calls share the gateway but are not part of the parent's record.
   */
  private readonly runToolResults: unknown[] = [];
  /**
   * The planning input of the current run (Iteration 26): kept for the offline
   * run record so an on-site failure can be replayed exactly.
   */
  private intentInput?: ClarifiedIntent;

  constructor(
    private readonly deps: AgentLoopDeps,
    private readonly ctx: RunContext,
  ) {}

  /** Request a pause; the loop stops at the next safe boundary. */
  pause(reason = 'user requested'): void {
    this.pauseRequested = true;
    this.ctx.infra.logger.info('pause requested', { reason });
  }

  /** Request cancellation; the loop unwinds and reports `cancelled`. */
  cancel(reason = 'cancelled'): void {
    this.cancelReason = reason;
  }

  /**
   * Change the goal mid-flight (whitepaper §4.7, metric M7).
   *
   * The new goal replaces the protected slot and is pinned into context, so the
   * very next model call is re-anchored without losing completed work.
   */
  intervene(instruction: string): void {
    this.pendingIntervention = instruction;
  }

  get status(): TaskStatus {
    return this.state.current;
  }

  /** The task this loop is running. Exposed for runtime-level event attribution. */
  get currentTaskId(): string {
    return this.ctx.taskId;
  }

  /**
   * Run the full lifecycle for one task.
   *
   * Always resolves with a `TaskOutcome` — failures are reported, never thrown,
   * because the caller (CLI/UI) must always be able to render a final state.
   */
  async run(intent: ClarifiedIntent, options: RunOptions = {}): Promise<TaskOutcome> {
    const meta = runMeta(this.ctx);
    const startedAt = this.ctx.ports.clock.now();
    const artifacts: Artifact[] = [];
    const verdicts: Verdict[] = [];

    this.recalledMemoryIds = new Set(); // fresh task → fresh memory feedback window
    this.state = TaskStateMachine.restore('received');
    this.transition('clarifying', 'intent accepted');
    this.intentInput = intent;
    this.deps.context.setGoal(intent.goal);
    for (const constraint of intent.constraints) this.deps.context.addConstraint(constraint);

    // ---- planning ----------------------------------------------------------
    this.transition('planning', 'decompose the goal');
    let plan: Plan;
    try {
      plan = options.plan ?? (await this.deps.planner.plan(intent));
    } catch (error) {
      if (!(error instanceof PathEnumError)) throw error;
      await this.ctx.infra.store.recordFailureMode({
        kind: 'path-hallucination',
        mechanism: 'planner schema rejects paths outside the workspace listing',
        workspace: this.ctx.workspace,
      });
      const empty = fallbackPlan(this.ctx.taskId, intent.goal, [], 'fast');
      return this.finish('failed', startedAt, artifacts, verdicts, empty, 0, 0, error.message);
    }
    await this.savePlan(plan);
    // Decision point 1 — planning complete: self-review the plan, then recall
    // and inject relevant memories before any work starts (Iteration 20).
    await this.selfReviewAt('planning', plan, intent);
    await this.injectMemories(intent);
    this.syncTodos(plan);
    this.emitProgress(plan, 0);

    const ordered = topologicalOrder(plan.steps);
    const totalWeight = ordered.reduce((sum, s) => sum + s.weight, 0) || 1;
    let completedWeight = 0;
    let stepsCompleted = 0;
    let unverifiedSteps = 0;
    let noProgressStreak = 0;
    let replanUsed = false;
    let checkpointId: Id | undefined;

    // ---- plan gate ---------------------------------------------------------
    const gated = await this.approvePlan(plan, 'plan ready for review');
    if (!gated.ok) {
      return this.finish('cancelled', startedAt, artifacts, verdicts, plan, 0, 0, gated.reason);
    }
    plan = gated.plan;

    // ---- executing ---------------------------------------------------------
    this.transition('executing', 'plan approved');

    for (const step of ordered) {
      if (this.cancelReason) return this.finish('cancelled', startedAt, artifacts, verdicts, plan, stepsCompleted, unverifiedSteps, this.cancelReason);

      // A user intervention takes effect at the next step boundary.
      if (this.pendingIntervention) {
        const previousGoal = this.deps.context.protectedSlots.goal;
        const newGoal = this.pendingIntervention;
        this.pendingIntervention = undefined;
        this.deps.context.setGoal(newGoal);
        this.deps.context.append(
          { role: 'system', content: `The user changed the goal mid-task. New goal: ${newGoal}` },
          { pinned: true },
        );
        this.ctx.infra.bus.emit('task.intervened', { instruction: newGoal, previousGoal, newGoal }, meta);
        this.ctx.infra.metrics.inc('task.interventions');
      }

      if (this.pauseRequested) {
        return this.pauseOutcome(startedAt, artifacts, verdicts, plan, stepsCompleted, unverifiedSteps, step.idx);
      }
      if (options.startStepIdx !== undefined && step.idx < options.startStepIdx) continue;
      if (step.status === 'done') {
        completedWeight += step.weight;
        stepsCompleted += 1;
        continue;
      }

      checkpointId = await this.createCheckpoint(step.idx, intent.goal);

      step.status = 'running';
      step.startedAt = this.ctx.ports.clock.now();
      await this.persistStep(step);
      this.syncTodos(plan);

      const firstRoute = await this.routeStep(step, plan, 0);
      const result = await this.deps.executor.execute(step, {
        stepIndex: step.idx + 1,
        stepTotal: ordered.length,
        completedSummaries: this.completedStepTitles(ordered),
        model: firstRoute.model,
        reflect: firstRoute.reflect,
      });
      artifacts.push(...result.artifacts);
      this.runToolResults.push(result.toolCalls);

      // ---- verifying -------------------------------------------------------
      this.transition('verifying', `verify step ${step.idx + 1}`);
      let verdict = await this.deps.verifier.verify(step, result);
      verdicts.push(verdict);
      this.iterations += 1;

      // Last executed attempt, for the zero-tool-calls failure classification.
      let lastStepResult = result;
      let fixAttempt = 1;
      // Decision point 2 — verification failed: think before retrying/replanning.
      if (verdict.status === 'fail') await this.selfReviewAt('verification-fail', plan, intent);
      while (verdict.status === 'fail' && fixAttempt <= this.deps.config.maxRetries && !this.cancelReason) {
        const errorClass = this.deps.recovery.classify(new Error(verdict.reason));
        const strategy = this.deps.recovery.strategy(errorClass, fixAttempt);
        this.ctx.infra.bus.emit('recovery.attempted', { strategy: strategy.kind, attempt: fixAttempt }, meta);

        if (strategy.kind !== 'retry') break;

        const retryRoute = await this.routeStep(step, plan, fixAttempt);
        const fixResult = await this.deps.executor.execute(step, {
          stepIndex: step.idx + 1,
          stepTotal: ordered.length,
          completedSummaries: this.completedStepTitles(ordered),
          fixupFailures: verdict.reason.split(' | ').filter((r) => r.startsWith('FAIL')),
          model: retryRoute.model,
          reflect: retryRoute.reflect,
        });
        artifacts.push(...fixResult.artifacts);
        this.runToolResults.push(fixResult.toolCalls);
        lastStepResult = fixResult;
        verdict = await this.deps.verifier.verify(step, fixResult);
        verdicts.push(verdict);
        this.iterations += 1;
        fixAttempt += 1;
        // Convergence guard (Iteration 26, Stage 4.3 — s2 field): a fixup that
        // failed verification with zero tool calls is a model that declined to
        // act even though the fixup prompt named the exact FAIL reasons. Further
        // fixup rounds only repeat the empty attempt (field: ~57s run burned on
        // repeated no-action turns). Stop retrying here and let the replan
        // escalation decide — a bounded mechanism, not a prompt rule.
        if (fixResult.toolCalls.length === 0) break;
      }

      if (verdict.status === 'fail') {
        // Zero-tool-calls (Iteration 24, failure mode wiring): the step failed
        // verification and the last attempt never called a tool — the model
        // declared completion without acting. Recorded against the executor
        // break-on-no-tools path so the next plan can read it.
        if (lastStepResult.toolCalls.length === 0) {
          await this.ctx.infra.store.recordFailureMode({
            kind: 'zero-tool-calls',
            mechanism: 'executor: step failed verification with zero tool calls (Executor.execute breaks when the model requests no tools)',
            workspace: this.ctx.workspace,
          });
        }
        // Structural escalation: replan once for the remaining work.
        if (!replanUsed) {
          replanUsed = true;
          this.ctx.infra.bus.emit('recovery.attempted', { strategy: 'replan', attempt: fixAttempt }, meta);
          this.transition('planning', 'replan after repeated verification failure');
          let revised: Plan;
          try {
            revised = await this.deps.planner.revise(
              plan,
              { reason: `Step "${step.title}" failed verification: ${verdict.reason}`, previousTitles: plan.steps.map((s) => s.title) },
              intent,
            );
          } catch (error) {
            if (!(error instanceof PathEnumError)) throw error;
            await this.ctx.infra.store.recordFailureMode({
              kind: 'path-hallucination',
              mechanism: 'planner schema rejects paths outside the workspace listing',
              workspace: this.ctx.workspace,
            });
            return this.finish('failed', startedAt, artifacts, verdicts, plan, stepsCompleted, unverifiedSteps, error.message);
          }
          plan = revised;
          await this.savePlan(plan);
          // A revised plan is a fresh plan — review it and re-inject memories.
          await this.selfReviewAt('planning', plan, intent);
          await this.injectMemories(intent);
          const remaining = topologicalOrder(plan.steps).filter((s) => s.idx >= step.idx);
          // Mark the failed step so the revised plan can supersede it.
          step.status = 'failed';
          step.endedAt = this.ctx.ports.clock.now();
          await this.persistStep(step);
          this.ctx.infra.bus.emit('step.failed', { step, error: verdict.reason, score: -3 }, meta);
          // Undo the failed step's mutations before replanning, so the revised
          // plan starts from a clean workspace and its own checkpoint mark is honest.
          await this.rollback(checkpointId);
          const regated = await this.approvePlan(plan, 'revised plan ready for review');
          if (!regated.ok) {
            return this.finish('cancelled', startedAt, artifacts, verdicts, plan, stepsCompleted, unverifiedSteps, regated.reason);
          }
          plan = regated.plan;
          this.transition('executing', 'resume with revised plan');

          const resumed = await this.runRemaining(intent, plan, remaining, artifacts, verdicts, completedWeight, totalWeight, stepsCompleted, unverifiedSteps);
          return this.finish(resumed.status, startedAt, resumed.artifacts, resumed.verdicts, plan, resumed.stepsCompleted, resumed.unverifiedSteps, resumed.reason);
        }

        step.status = 'failed';
        step.endedAt = this.ctx.ports.clock.now();
        await this.persistStep(step);
        this.ctx.infra.bus.emit('step.failed', { step, error: verdict.reason, score: -3 }, meta);
        // Roll the step back so the workspace is not left half-mutated.
        await this.rollback(checkpointId);
        await this.applyMemoryOutcomeFeedback(false); // recipe disproved by outcome
        return this.finish('failed', startedAt, artifacts, verdicts, plan, stepsCompleted, unverifiedSteps, `Step "${step.title}" failed: ${verdict.reason}`);
      }

      // ---- step accepted ---------------------------------------------------
      if (verdict.status === 'unknown') {
        unverifiedSteps += 1;
        noProgressStreak += 1;
      } else {
        noProgressStreak = 0;
      }

      step.status = 'done';
      step.endedAt = this.ctx.ports.clock.now();
      await this.persistStep(step);
      const stepScore = verdict.status === 'pass' ? 3 : verdict.status === 'unknown' ? 1 : 1;
      this.ctx.infra.bus.emit('step.completed', { step, result, score: stepScore }, meta);
      completedWeight += step.weight;
      stepsCompleted += 1;
      this.emitProgress(plan, completedWeight / totalWeight);

      // ---- drift check -----------------------------------------------------
      await this.checkDrift(intent, result.summary, noProgressStreak);

      if (noProgressStreak >= this.deps.config.noProgressThreshold) {
        this.ctx.infra.bus.emit('reliability.no_progress', {
          streak: noProgressStreak,
          action: 're-anchor-goal',
        }, meta);
        this.deps.context.append(
          { role: 'system', content: `Re-anchor: you have made no verifiable progress for ${noProgressStreak} steps. Goal: ${intent.goal}` },
          { pinned: true },
        );
        noProgressStreak = 0;
      }

      if (this.cancelReason) return this.finish('cancelled', startedAt, artifacts, verdicts, plan, stepsCompleted, unverifiedSteps, this.cancelReason);
      if (this.pauseRequested) {
        return this.pauseOutcome(startedAt, artifacts, verdicts, plan, stepsCompleted, unverifiedSteps, step.idx + 1);
      }
      this.transition('executing', 'next step');
    }

    // ---- delivering --------------------------------------------------------
    this.transition('delivering', 'all steps complete');
    const summary = this.buildSummary(intent, plan, stepsCompleted, unverifiedSteps, artifacts);
    this.ctx.infra.bus.emit('task.completed', { summary, artifacts }, meta);

    // ---- reflecting --------------------------------------------------------
    this.transition('reflecting', 'capture lessons');
    await this.reflect(intent, plan, artifacts, unverifiedSteps);

    return this.finish('done', startedAt, artifacts, verdicts, plan, stepsCompleted, unverifiedSteps);
  }

  /**
   * Term team lifecycle.
   *
   * The coordinator asks the decision model for worker goals, assigns each one
   * a catalog model, and runs them through the existing sub-agent orchestrator.
   * `task.completed` is emitted only when at least one worker report is `ok`.
   */
  async runTeam(intent: ClarifiedIntent, catalog: ModelInfo[] = []): Promise<TaskOutcome> {
    const meta = runMeta(this.ctx);
    const startedAt = this.ctx.ports.clock.now();
    this.recalledMemoryIds = new Set();
    this.state = TaskStateMachine.restore('received');
    this.transition('clarifying', 'team goal accepted');
    this.intentInput = intent;
    this.deps.context.setGoal(intent.goal);
    for (const constraint of intent.constraints) this.deps.context.addConstraint(constraint);
    this.transition('planning', 'coordinator splits the goal');

    if (!this.deps.subAgents) {
      const empty = fallbackPlan(this.ctx.taskId, intent.goal, [], 'fast');
      return this.finish('failed', startedAt, [], [], empty, 0, 0, 'sub-agent orchestrator is not configured');
    }

    const team = new TeamOrchestrator({
      ctx: this.ctx,
      subAgents: this.deps.subAgents,
      catalog: catalog.length > 0 ? catalog : [this.fallbackCatalogModel()],
      preferredModel: this.ctx.model,
      planText: async (goal) => {
        const result = await this.deps.gateway.call({
          purpose: 'plan',
          system: TEAM_COORDINATOR_SYSTEM,
          messages: [{ role: 'user', content: goal }],
          responseFormat: 'json',
          temperature: 0,
        });
        return result.text;
      },
      transition: (to, reason) => this.transition(to, reason),
      approve: (plan) => this.approvePlan(plan, 'team plan ready'),
    });
    const outcome = await team.run(intent.goal);
    await this.savePlan(outcome.plan);
    if (outcome.status === 'done') {
      this.ctx.infra.bus.emit('task.completed', { summary: outcome.summary, artifacts: outcome.artifacts }, meta);
      return this.finish('done', startedAt, outcome.artifacts, outcome.verdicts, outcome.plan, outcome.workersOk, 0);
    }
    if (outcome.status === 'cancelled') {
      return this.finish('cancelled', startedAt, [], [], outcome.plan, 0, 0, outcome.reason);
    }
    return this.finish('failed', startedAt, outcome.artifacts, outcome.verdicts, outcome.plan, 0, 0, outcome.reason);
  }

  /** Catalog stand-in when the provider advertised nothing. Context is not evidence. */
  private fallbackCatalogModel(): ModelInfo {
    const caps = this.deps.gateway.capabilities();
    return {
      id: this.ctx.model,
      providerId: 'active',
      label: this.ctx.model,
      contextWindow: this.deps.config.contextWindow,
      supportsTools: caps.supportsTools,
      supportsJson: caps.supportsJson,
      supportsVision: caps.supportsVision === true,
      capabilitySource: {
        vision: caps.supportsVision === true ? 'provider' : 'unknown',
        context: 'default',
        tools: 'provider',
      },
    };
  }

  /** Roll the workspace back to the state captured before `checkpointId`. */
  async rollback(checkpointId?: Id): Promise<number> {
    const meta = runMeta(this.ctx);
    if (!checkpointId) return 0;
    this.ctx.infra.bus.emit('recovery.rollback_started', { checkpointId }, meta);
    const restored = await this.deps.journal.rollbackTo(checkpointId);
    this.ctx.infra.bus.emit('recovery.rollback_done', { checkpointId, restored }, meta);
    this.ctx.infra.metrics.inc('recovery.rollback_success');
    return restored;
  }

  /** Run a nested, context-isolated agent. Used by the sub-agent orchestrator. */
  async runSubAgent(spec: SubAgentSpec, signal: AbortSignal): Promise<SubAgentReport> {
    const startedAt = this.ctx.ports.clock.now();
    const childCtx: RunContext = {
      ...this.ctx,
      taskId: `sub-${shortId(8)}`,
      traceId: shortId(12),
      signal,
      model: spec.model?.trim() || this.ctx.model,
    };
    const meta = runMeta(childCtx);
    const artifacts: Artifact[] = [];
    const verdicts: Verdict[] = [];

    const intent: ClarifiedIntent = {
      goal: spec.goal,
      assumptions: [],
      constraints: ['Stay within the focus paths if provided.'],
      expectedPaths: spec.focusPaths ?? [],
      complete: true,
    };

    childCtx.infra.bus.emit('plan.started', { mode: 'fast' }, meta);
    let plan: Plan;
    try {
      plan = await this.deps.planner.plan(intent);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return {
        id: newId(),
        parentTaskId: this.ctx.taskId,
        goal: spec.goal,
        status: 'error',
        summary: reason,
        artifacts,
        verdicts,
        tokensUsed: 0,
        startedAt,
        endedAt: this.ctx.ports.clock.now(),
      };
    }
    const ordered = topologicalOrder(plan.steps);

    let ok = true;
    const summaryLines: string[] = [];
    for (const step of ordered) {
      if (signal.aborted) { ok = false; summaryLines.push('aborted'); break; }
      const result = await this.deps.executor.execute(step, {
        stepIndex: step.idx + 1,
        stepTotal: ordered.length,
        completedSummaries: [],
      });
      artifacts.push(...result.artifacts);
      const verdict = await this.deps.verifier.verify(step, result);
      verdicts.push(verdict);
      if (verdict.status === 'fail') ok = false;
      summaryLines.push(`${step.title}: ${result.summary.slice(0, 200)}`);
    }

    return {
      id: newId(),
      parentTaskId: this.ctx.taskId,
      goal: spec.goal,
      status: ok ? 'ok' : 'error',
      summary: summaryLines.join('\n') || 'sub-agent produced no summary',
      artifacts,
      verdicts,
      tokensUsed: estimateTokens(summaryLines.join('\n')),
      startedAt,
      endedAt: this.ctx.ports.clock.now(),
    };
  }

  // ---------------------------------------------------------------------------
  // internals
  // ---------------------------------------------------------------------------

  /** Continue a run with a revised plan (used after replan). */
  private async runRemaining(
    intent: ClarifiedIntent,
    plan: Plan,
    remaining: Step[],
    artifacts: Artifact[],
    verdicts: Verdict[],
    completedWeight: number,
    totalWeight: number,
    stepsCompleted: number,
    unverifiedSteps: number,
  ): Promise<{ status: TaskOutcome['status']; artifacts: Artifact[]; verdicts: Verdict[]; stepsCompleted: number; unverifiedSteps: number; reason?: string }> {
    const meta = runMeta(this.ctx);
    for (const step of remaining) {
      if (this.cancelReason) return { status: 'cancelled', artifacts, verdicts, stepsCompleted, unverifiedSteps, reason: this.cancelReason };
      if (step.status === 'done') continue;

      const checkpointId = await this.createCheckpoint(step.idx, intent.goal);
      step.status = 'running';
      step.startedAt = this.ctx.ports.clock.now();
      await this.persistStep(step);
      this.syncTodos(plan);
      const resumedRoute = await this.routeStep(step, plan, 0);
      const result = await this.deps.executor.execute(step, {
        stepIndex: step.idx + 1,
        stepTotal: plan.steps.length,
        completedSummaries: this.completedStepTitles(plan.steps),
        model: resumedRoute.model,
        reflect: resumedRoute.reflect,
      });
      artifacts.push(...result.artifacts);
      this.runToolResults.push(result.toolCalls);
      const verdict = await this.deps.verifier.verify(step, result);
      verdicts.push(verdict);
      this.iterations += 1;

      if (verdict.status === 'fail') {
        await this.selfReviewAt('verification-fail', plan, intent);
        if (result.toolCalls.length === 0) {
          await this.ctx.infra.store.recordFailureMode({
            kind: 'zero-tool-calls',
            mechanism: 'executor: revised-plan step failed verification with zero tool calls (Executor.execute breaks when the model requests no tools)',
            workspace: this.ctx.workspace,
          });
        }
        step.status = 'failed';
        step.endedAt = this.ctx.ports.clock.now();
        await this.persistStep(step);
        this.ctx.infra.bus.emit('step.failed', { step, error: verdict.reason, score: -3 }, meta);
        // The revised plan still failed: leave the workspace as it was before the
        // step rather than half-mutated (whitepaper §3.11, metric M6).
        await this.rollback(checkpointId);
        await this.applyMemoryOutcomeFeedback(false); // recipe disproved by outcome
        return { status: 'failed', artifacts, verdicts, stepsCompleted, unverifiedSteps, reason: `Revised plan step "${step.title}" failed: ${verdict.reason}` };
      }

      if (verdict.status === 'unknown') unverifiedSteps += 1;
      step.status = 'done';
      step.endedAt = this.ctx.ports.clock.now();
      await this.persistStep(step);
      const stepScore = verdict.status === 'pass' ? 3 : verdict.status === 'unknown' ? 1 : 1;
      this.ctx.infra.bus.emit('step.completed', { step, result, score: stepScore }, meta);
      stepsCompleted += 1;
      completedWeight += step.weight;
      this.emitProgress(plan, completedWeight / totalWeight);
    }

    this.transition('delivering', 'revised plan complete');
    const summary = this.buildSummary(intent, plan, stepsCompleted, unverifiedSteps, artifacts);
    this.ctx.infra.bus.emit('task.completed', { summary, artifacts }, meta);
    this.transition('reflecting', 'capture lessons');
    await this.reflect(intent, plan, artifacts, unverifiedSteps);
    return { status: 'done', artifacts, verdicts, stepsCompleted, unverifiedSteps };
  }

  private async checkDrift(intent: ClarifiedIntent, currentOutput: string, noProgressStreak: number): Promise<void> {
    const meta = runMeta(this.ctx);
    const touched = this.deps.journal.list().map((e) => e.relPath);
    const assessment = this.deps.drift.assess({
      goal: intent.goal,
      currentOutput,
      expectedPaths: intent.expectedPaths,
      touchedPaths: touched,
      noProgressStreak,
    });
    this.ctx.infra.metrics.observe('drift.score', assessment.score);
    if (!assessment.drifted) return;

    // Declared-but-ineffective (Iteration 24, failure mode wiring): the model
    // produced output that diverges from the goal — work was declared, but it is
    // not moving the task. Recorded against the drift path so the next plan for
    // this workspace can read it.
    await this.ctx.infra.store.recordFailureMode({
      kind: 'declared-but-ineffective',
      mechanism: `drift: output diverged from the goal (score ${assessment.score}; DriftDetector.assess)`,
      workspace: this.ctx.workspace,
    });

    this.ctx.infra.bus.emit('reliability.drift_detected', {
      score: assessment.score,
      signals: assessment.signals,
      action: 'reanchor',
    }, meta);
    // Re-anchor: restate the goal into the protected slot and pin a reminder.
    this.deps.context.setGoal(intent.goal);
    this.deps.context.append(
      { role: 'system', content: `Drift detected (${assessment.score}). Re-focus on the goal: ${intent.goal}` },
      { pinned: true },
    );
  }

  private async createCheckpoint(stepIdx: number, goal: string): Promise<Id> {
    const meta = runMeta(this.ctx);
    const manifest = await this.buildManifest();
    const checkpoint: Checkpoint = {
      id: newId(),
      taskId: this.ctx.taskId,
      stepIdx,
      ctxSummary: `before step ${stepIdx + 1}: ${goal}`,
      fsManifest: manifest,
      createdAt: this.ctx.ports.clock.now(),
    };
    // Tag the journal depth so rollback(checkpoint.id) only undoes files touched
    // *after* this checkpoint, not the entire task's mutations.
    this.deps.journal.mark(checkpoint.id);
    try {
      await this.ctx.infra.store.saveCheckpoint(checkpoint);
    } catch (error) {
      this.ctx.infra.logger.warn('failed to persist checkpoint', { error: String(error) });
    }
    this.ctx.infra.bus.emit('checkpoint.created', { checkpoint }, meta);
    return checkpoint.id;
  }

  private async buildManifest(): Promise<FsManifest> {
    const entries: Record<string, string> = {};
    for (const entry of this.deps.journal.list()) {
      try {
        if (await this.ctx.ports.fs.exists(entry.path)) {
          entries[entry.relPath] = await this.ctx.ports.fs.hash(entry.path);
        }
      } catch {
        // A file that vanished mid-run is simply absent from the manifest.
      }
    }
    return { entries };
  }

  private buildSummary(
    intent: ClarifiedIntent,
    plan: Plan,
    stepsCompleted: number,
    unverifiedSteps: number,
    artifacts: Artifact[],
  ): string {
    const lines = [
      `Goal: ${intent.goal}`,
      `Steps completed: ${stepsCompleted}/${plan.steps.length}`,
      artifacts.length ? `Artifacts: ${[...new Set(artifacts.map((a) => a.path))].join(', ')}` : 'Artifacts: none',
    ];
    if (unverifiedSteps > 0) {
      lines.push(`Caveat: ${unverifiedSteps} step(s) could not be objectively verified (no failing check, but no proof either).`);
    }
    return lines.join('\n');
  }

  /**
   * Write durable memories so the next task benefits (Iteration 20).
   *
   * Runs the self-review at the reflection decision point, then writes three
   * kinds of memory through the memory service:
   * - an artifact record (short-term, session),
   * - a lesson when verification left gaps or the self-review flagged concerns
   *   (long-term, never mechanically evicted),
   * - a procedural recipe on successful multi-step tasks (procedural layer,
   *   escalated from reflection, never mechanically evicted).
   */
  private async reflect(intent: ClarifiedIntent, plan: Plan, artifacts: Artifact[], unverifiedSteps: number): Promise<void> {
    try {
      const keywords = [...new Set(intent.goal.toLowerCase().split(/\W+/).filter((w) => w.length > 3))].slice(0, 8).join(',');

      // Decision point 3 — reflection: review the executed plan.
      const review = await this.selfReviewAt('reflect', plan, intent);

      // Settings hides this row (`isCuratedMemory`). The task panel can still list it.
      await this.deps.memory.remember({
        scope: 'session',
        sessionId: this.ctx.sessionId,
        kind: 'artifact',
        content: `Task "${intent.goal}" produced ${artifacts.length} artifact(s) across ${plan.steps.length} step(s).`,
        keywords,
        importance: 0.4,
        correctness: 1,
      });

      if (unverifiedSteps > 0 || review?.verdict === 'revise') {
        const problems: string[] = [];
        if (unverifiedSteps > 0) problems.push(`${unverifiedSteps} unverified step(s)`);
        if (review && review.verdict === 'revise') {
          problems.push(`self-review concerns: ${selfReviewConcerns(review)}`);
        }
        await this.deps.memory.remember({
          scope: 'global',
          kind: 'lesson',
          content: `Task "${intent.goal}" ended with gaps: ${problems.join('; ')}.`,
          keywords,
          importance: 0.7,
          retrievable: false,
        });
      }

      // Procedural memory: a multi-step task that fully succeeded is a recipe.
      if (plan.steps.length >= 3 && unverifiedSteps === 0) {
        const recipe = plan.steps.map((s) => s.title).join(' → ');
        await this.deps.memory.remember({
          scope: 'global',
          kind: 'procedural',
          content: `When asked to "${intent.goal}", a working approach is: ${recipe}.`,
          keywords,
          importance: 0.6,
          retrievable: false,
          correctness: 1,
        });
      }

      // Outcome feedback: procedural recipes that were injected into this run are
      // strengthened (correctness → 1) when the task fully verified, or downgraded
      // (correctness → 0, excluded from future recall) when verification left gaps.
      // This closes the "hit → validate → strengthen / downgrade" loop (Iteration 21).
      await this.applyMemoryOutcomeFeedback(unverifiedSteps === 0 && review?.verdict !== 'revise');

      // Session-lifecycle promotion (Iteration 21): important short-term memories
      // from this task survive across sessions; trivial ones stay session-scoped.
      // The importance threshold is a config knob (Iteration 22, default 0.6).
      await this.deps.memory.promoteShortTerm(this.deps.config.promoteShortTermThreshold);

      await this.deps.memory.evictIfOverBudget();
    } catch (error) {
      this.ctx.infra.logger.debug('reflection skipped', { error: String(error) });
    }
  }

  /**
   * Run the four-question self-review at a decision point (Iteration 20).
   *
   * Fast-path plans are exempt (planning tax must not drag down trivial tasks);
   * the skip is still observable via `selfreview.skipped`. A `revise` verdict
   * pins the concerns into context so the very next model call sees them.
   */
  private async selfReviewAt(
    point: SelfReviewDecisionPoint,
    plan: Plan,
    intent: ClarifiedIntent,
  ): Promise<SelfReviewResult | undefined> {
    const meta = runMeta(this.ctx);
    if (!this.deps.selfReview.shouldReview(plan)) {
      if (point === 'planning') {
        this.ctx.infra.bus.emit('selfreview.skipped', { decisionPoint: point, reason: 'fast-path' }, meta);
      }
      return undefined;
    }
    const result = this.deps.selfReview.review(point, plan, intent);
    this.ctx.infra.bus.emit(
      'selfreview.performed',
      {
        decisionPoint: point,
        verdict: result.verdict,
        mode: result.mode,
        planId: result.planId,
        questions: result.questions,
      },
      meta,
    );
    this.ctx.infra.metrics.inc('selfreview.performed', { verdict: result.verdict, point });
    const concerns = selfReviewConcerns(result);
    if (concerns) {
      this.deps.context.append(
        { role: 'system', content: `[self-review ${point}] Plan concerns: ${concerns}` },
        { pinned: true },
      );
      this.ctx.infra.logger.info('self-review flagged concerns', { point, concerns });
    }
    return result;
  }

  /**
   * Recall and inject relevant memories at a key decision point.
   *
   * Working memory is strongly retained: the injected block is small (≤5 items,
   * one line each) and pinned so it survives compaction for the whole task.
   */
  private async injectMemories(intent: ClarifiedIntent): Promise<void> {
    try {
      const due = await this.deps.memory.reactivationDue(3);
      const recalled = await this.deps.memory.recall({
        text: intent.goal,
        limit: 5,
        sessionId: this.ctx.sessionId,
      });
      const merged: MemoryItem[] = [];
      const seen = new Set<string>();
      for (const item of [...due, ...recalled]) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        merged.push(item);
        if (merged.length >= 5) break;
      }
      if (merged.length === 0) return;
      for (const item of merged) this.recalledMemoryIds.add(item.id); // outcome feedback window
      const block = merged
        .map((item) => `- [${item.layer ?? item.scope}] ${item.content.slice(0, 160)}`)
        .join('\n');
      this.deps.context.append(
        { role: 'system', content: `<remembered-context>\n${block}\n</remembered-context>` },
        { pinned: true },
      );
    } catch (error) {
      this.ctx.infra.logger.debug('memory recall skipped', { error: String(error) });
    }
  }

  /**
   * Close the memory outcome-feedback loop (Iteration 21).
   *
   * Every procedural memory that was injected into the current task is given
   * correctness feedback from the task outcome: a fully verified task raises it
   * to correctness 1 — recording *which* verification passed (taskId + verdict,
   * Iteration 22) so the boost is traceable; a failed or gapped task marks it
   * known-bad (correctness 0), which excludes it from future recall until
   * evidence clears it. The downgrade is observable via `memory.downgraded`;
   * validation is observable via the subsequent `memory.recalled` strength
   * update. Never throws — memory feedback must not break task completion.
   */
  private async applyMemoryOutcomeFeedback(succeeded: boolean): Promise<void> {
    if (this.recalledMemoryIds.size === 0) return;
    const ids = [...this.recalledMemoryIds];
    this.recalledMemoryIds = new Set(); // feedback applied once per task
    for (const id of ids) {
      try {
        const item = await this.deps.memory.get(id);
        if (!item || item.kind !== 'procedural') continue;
        if (succeeded) {
          await this.deps.memory.markCorrect(id, {
            taskId: this.ctx.taskId,
            verdict: 'pass',
            at: this.ctx.ports.clock.now(),
            detail: 'all steps verified; task completed',
          });
        } else {
          await this.deps.memory.markIncorrect(id, 'task-verification-gap');
        }
      } catch (error) {
        this.ctx.infra.logger.debug('memory outcome feedback skipped', { memoryId: id, error: String(error) });
      }
    }
  }

  private emitProgress(plan: Plan, ratio: number): void {
    const progress = Math.max(0, Math.min(1, ratio));
    this.ctx.infra.bus.emit('task.progress', {
      progress,
      currentStepIdx: Math.round(progress * plan.steps.length),
      totalSteps: plan.steps.length,
    }, runMeta(this.ctx));
  }

  private transition(to: TaskStatus, reason: string): void {
    const result = this.state.transition(to, reason);
    if (!result.ok) {
      this.ctx.infra.logger.warn('illegal task transition', { from: this.state.current, to, reason });
      return;
    }
    const meta = runMeta(this.ctx);
    this.ctx.infra.bus.emit('task.status_changed', { from: result.from, to: result.to, reason }, meta);
    this.ctx.infra.bus.emit('task.phase_changed', { phase: phaseOf(to) }, meta);
    void this.ctx.infra.store
      .updateTask(this.ctx.taskId, { status: to, phase: phaseOf(to) })
      .catch((error: unknown) => this.ctx.infra.logger.warn('task status persist failed', { error: String(error) }));
  }

  private async persistStep(step: Step): Promise<void> {
    try {
      await this.ctx.infra.store.upsertStep(step);
    } catch (error) {
      this.ctx.infra.logger.warn('failed to persist step', { stepId: step.id, error: String(error) });
    }
  }

  /**
   * Push live step status into the protected todo slot.
   *
   * The slot is what the model actually reads (`open-todos` inside
   * `<protected-context>`). Writing it once at plan time left every step
   * `[pending]` for the rest of the run — Iteration 24's live failure, where
   * the second todo never left pending. Status on the step object and status
   * in the prompt have to be the same string.
   */
  private syncTodos(plan: Plan): void {
    this.deps.context.setTodos(plan.steps.map((step) => `[${step.status}] ${step.title}`));
  }

  /** Titles of steps already accepted, in plan order. */
  private completedStepTitles(steps: Step[]): string[] {
    return steps.filter((step) => step.status === 'done').map((step) => step.title);
  }

  /**
   * Enter `awaiting-approval`. Auto mode, a session-scoped approval, or the
   * absence of a gate (in-process tests) continues. A person can edit in place
   * or reject, which cancels.
   */
  private async routeStep(
    step: Step,
    plan: Plan,
    attempt: number,
  ): Promise<{ model: string; reflect: boolean }> {
    const inDegree = plan.steps.filter((other) => other.deps.includes(step.id)).length;
    const fileCount = step.acceptance.filter((point) => typeof point.params.path === 'string').length;
    const historical = await this.ctx.infra.store.countFailureModes(this.ctx.workspace);
    const score = difficultyScore({
      weight: step.weight,
      inDegree,
      fileCount,
      historicalFailures: historical,
    });
    const usage = this.deps.gateway.usage;
    const tokens = usage.promptTokens + usage.completionTokens;
    const estimatedUsd = estimateUsd(tokens, this.ctx.model);
    const ceiling = this.deps.config.maxCostPerTask;
    const overBudget = ceiling > 0 && estimatedUsd >= ceiling;
    const choice = modelForAttempt(
      attempt,
      { decision: this.ctx.model, grunt: this.ctx.gruntModel || this.ctx.model },
      score,
      overBudget,
    );
    this.ctx.infra.bus.emit(
      'routing.chosen',
      {
        stepId: step.id,
        model: choice.model,
        line: `${choice.reason}. ${tokens} tokens, about $${estimatedUsd.toFixed(4)}.`,
        estimatedUsd,
        tokens,
      },
      runMeta(this.ctx),
    );
    return choice;
  }

  private async approvePlan(plan: Plan, reason: string): Promise<{ ok: true; plan: Plan } | { ok: false; reason: string }> {
    this.transition('awaiting-approval', reason);
    const gate = this.deps.planGate;
    if (this.deps.config.planApproval === 'auto' || gate?.sessionAutoApprove || !gate) {
      return { ok: true, plan };
    }
    let current = plan;
    for (;;) {
      const decision = await gate.ask(this.ctx.taskId);
      if (decision.action === 'approve') return { ok: true, plan: current };
      if (decision.action === 'reject') {
        const why = decision.reason || 'plan rejected';
        this.transition('cancelled', why);
        return { ok: false, reason: why };
      }
      const previousRevision = current.revision;
      current = applyPlanEdits(current, decision.edits);
      await this.savePlan(current);
      this.ctx.infra.bus.emit('plan.revised', { previousRevision, plan: current, reason: 'user edit' }, runMeta(this.ctx));
    }
  }

  private async savePlan(plan: Plan): Promise<void> {
    try {
      await this.ctx.infra.store.updateTask(this.ctx.taskId, { plan });
    } catch (error) {
      this.ctx.infra.logger.warn('failed to persist plan', { error: String(error) });
    }
  }

  private pauseOutcome(
    startedAt: number,
    artifacts: Artifact[],
    verdicts: Verdict[],
    plan: Plan,
    stepsCompleted: number,
    unverifiedSteps: number,
    resumeStepIdx: number,
  ): TaskOutcome {
    const meta = runMeta(this.ctx);
    this.state.pause('user requested');
    this.ctx.infra.bus.emit('task.paused', { reason: 'user requested' }, meta);
    void this.ctx.infra.store
      .updateTask(this.ctx.taskId, { status: 'paused', resumeTarget: this.state.pausedFrom, phase: phaseOf('paused') })
      .catch(() => undefined);
    return {
      taskId: this.ctx.taskId,
      status: 'paused',
      summary: `Paused after ${stepsCompleted}/${plan.steps.length} steps.`,
      artifacts,
      verdicts,
      stepsCompleted,
      stepsTotal: plan.steps.length,
      unverifiedSteps,
      iterations: this.iterations,
      tokensUsed: this.tokensUsed(),
      durationMs: this.ctx.ports.clock.now() - startedAt,
      resumeStepIdx,
    };
  }

  private async finish(
    status: TaskOutcome['status'],
    startedAt: number,
    artifacts: Artifact[],
    verdicts: Verdict[],
    plan: Plan,
    stepsCompleted: number,
    unverifiedSteps: number,
    reason?: string,
  ): Promise<TaskOutcome> {
    const meta = runMeta(this.ctx);
    this.syncTodos(plan);
    if (status === 'done' && !this.state.isTerminal) this.transition('done', 'delivered');
    if (status === 'failed' && !this.state.isTerminal) this.transition('failed', reason ?? 'failed');
    if (status === 'cancelled' && !this.state.isTerminal) this.transition('cancelled', reason ?? 'cancelled');
    if (status === 'failed') this.ctx.infra.bus.emit('task.failed', { reason: reason ?? 'failed', recoverable: false }, meta);
    if (status === 'cancelled') this.ctx.infra.bus.emit('task.cancelled', { reason: reason ?? 'cancelled' }, meta);

    // Offline run record (Iteration 24): model, prompts, context snapshot and
    // tool results are written so a phase check can replay what the run saw.
    // The record is a best-effort side effect — a write failure must not change
    // the task outcome, and the location is logged for later inspection.
    await this.writeRunRecord();

    let summary: string;
    if (status === 'done') {
      const lines = [
        `Steps completed: ${stepsCompleted}/${plan.steps.length}`,
        artifacts.length ? `Artifacts: ${[...new Set(artifacts.map((a) => a.path))].join(', ')}` : 'Artifacts: none',
      ];
      if (unverifiedSteps > 0) {
        lines.push(`Caveat: ${unverifiedSteps} step(s) could not be objectively verified.`);
      }
      summary = lines.join('\n');
    } else {
      summary = reason ?? status;
    }

    return {
      taskId: this.ctx.taskId,
      status,
      summary,
      artifacts,
      verdicts,
      stepsCompleted,
      stepsTotal: plan.steps.length,
      unverifiedSteps,
      iterations: this.iterations,
      tokensUsed: this.tokensUsed(),
      durationMs: this.ctx.ports.clock.now() - startedAt,
      reason,
    };
  }

  /** Best-effort write of the offline run record; never throws into the loop. */
  private async writeRunRecord(): Promise<void> {
    const dir = this.deps.config.runRecordDir;
    if (!dir) return;
    try {
      const target = path.join(dir, this.ctx.taskId);
      // The raw intent lives on the persisted task row (created by the runtime
      // with the user's exact words). Best-effort: a missing row (unit harness)
      // yields undefined — the record stays valid.
      const task = await this.ctx.infra.store.getTask(this.ctx.taskId).catch(() => undefined);
      await writeRunRecord(target, {
        model: this.ctx.model,
        gruntModel: this.ctx.gruntModel === this.ctx.model ? undefined : this.ctx.gruntModel,
        prompts: this.deps.gateway.promptLog.map((entry) => JSON.stringify(entry)),
        context: this.deps.context.dump(),
        toolResults: this.runToolResults,
        // Iteration 26: raw intent + planning input, so any on-site failure is
        // offline-replayable. Old records read these as undefined.
        intentRaw: task?.intentRaw,
        planInput: this.intentInput,
      });
      this.ctx.infra.logger.info('run record written', { dir: target, taskId: this.ctx.taskId });
    } catch (error) {
      this.ctx.infra.logger.warn('failed to write run record', {
        taskId: this.ctx.taskId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private tokensUsed(): number {
    const usage = this.deps.gateway.usage;
    return usage.promptTokens + usage.completionTokens;
  }
}
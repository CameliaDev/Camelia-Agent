/**
 * Task planner (whitepaper §3.2).
 *
 * Turns a `ClarifiedIntent` into an ordered, verifiable `Plan`. The model proposes;
 * `plan-utils` disposes — normalisation, cycle breaking and the single-step
 * fallback mean a planner call can never leave the loop without a usable plan.
 * @module
 */

import type { ClarifiedIntent, Plan, ProviderCapabilities } from '@camelia/core';

import type { RunContext } from '../context/RunContext.js';
import { runMeta } from '../context/RunContext.js';
import { workspaceSummary } from '../context/workspace-summary.js';
import { ModelGateway } from '../model/ModelGateway.js';
import { loadProfileForWorkspace } from '../profile/profile-loader.js';
import { granularityFor, plannerSystemPrompt } from '../prompts/system.js';
import { extractJsonObject } from './json.js';
import { dagDepth, fallbackPlan, normalisePlan, type RawPlan } from './plan-utils.js';
import { PathEnumError, pathViolations } from './paths.js';

export interface PlanRevision {
  reason: string;
  previousTitles: string[];
}

export interface PlannerOptions {
  /** Test seam: override the workspace listing instead of reading the fs. */
  workspaceSummaryOverride?: string;
}

export class Planner {
  /**
   * @param toolNames Names of the tools the executor can use. The planner needs
   *   these so it does not emit steps those tools cannot perform — measured: a
   *   weak model planned "Create directory 'src'" for a task that only needed a
   *   file written, and the step then failed with nothing actionable.
   */
  constructor(
    private readonly gateway: ModelGateway,
    private readonly ctx: RunContext,
    private readonly toolNames: readonly string[] = [],
  ) {}

  /** Profile loaded lazily on the first planning call; shared by plan/revise/replan. */
  private profilePromise: Promise<import('../profile/project-profile.js').ProjectProfile | undefined> | undefined;

  capabilities(): ProviderCapabilities {
    return this.gateway.capabilities();
  }

  /** Produce the initial plan. Always returns a plan (fallback on failure). */
  async plan(intent: ClarifiedIntent, options: PlannerOptions = {}): Promise<Plan> {    const meta = runMeta(this.ctx);
    const mode = this.pickMode(intent);
    this.ctx.infra.bus.emit('plan.started', { mode }, meta);

    const caps = this.gateway.capabilities();
    const granularity = granularityFor(caps, this.ctx.config.maxSteps);
    const summary =
      options.workspaceSummaryOverride ??
      (await workspaceSummary(this.ctx.ports.fs, this.ctx.workspace, { maxEntries: 120 }));

    const priorPathFailures = await this.ctx.infra.store.countFailureModes(this.ctx.workspace, 'path-hallucination');
    const pathNote = priorPathFailures > 0
      ? `\nThis workspace has ${priorPathFailures} recorded path-hallucination failure(s). Use only the allowed path enum.`
      : '';

    // Project profile (Iteration 24): conventions / pitfalls / verification /
    // forbidden rules join the plan prompt. A missing or broken profile is logged
    // and the task continues — it must never block planning.
    const profile = await this.loadProfile();

    try {
      const result = await this.gateway.call({
        purpose: 'plan',
        system: plannerSystemPrompt({
          intent,
          workspaceSummary: summary,
          granularity,

          toolNames: this.toolNames,

          directives: this.ctx.presetDirectives,
          profile,
        }) + pathNote,
        messages: [{ role: 'user', content: 'Produce the plan now.' }],
        responseFormat: 'json',
        maxTokens: 2_000,
      });

      const raw = extractJsonObject<RawPlan>(result.text);
      const plan = normalisePlan(raw, {
        taskId: this.ctx.taskId,
        maxSteps: granularity.maxSteps,
        mode,
      });

      if (!plan) {
        this.ctx.infra.logger.warn('planner produced no usable steps; falling back', {
          text: result.text.slice(0, 400),
        });
        const fallback = fallbackPlan(this.ctx.taskId, intent.goal, intent.expectedPaths, 'fast');
        this.ctx.infra.bus.emit('plan.ready', { plan: fallback }, meta);
        return fallback;
      }

      const rejected = pathViolations(plan, intent.expectedPaths);
      if (rejected.length === 0) {
        this.publish(plan, meta);
        return plan;
      }

      const retried = await this.replanOffList(intent, granularity, summary, rejected, mode, plan.mode);
      this.publish(retried, meta);
      return retried;
    } catch (error) {
      if (error instanceof PathEnumError) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      this.ctx.infra.logger.error('planner call failed; using fallback plan', { reason });
      this.ctx.infra.bus.emit('plan.failed', { reason }, meta);
      const fallback = fallbackPlan(this.ctx.taskId, intent.goal, intent.expectedPaths, 'fast');
      this.ctx.infra.bus.emit('plan.ready', { plan: fallback }, meta);
      return fallback;
    }
  }

  /** Re-plan after verification failures or a user intervention. */
  async revise(plan: Plan, revision: PlanRevision, intent: ClarifiedIntent): Promise<Plan> {
    const meta = runMeta(this.ctx);
    const caps = this.gateway.capabilities();
    const granularity = granularityFor(caps, this.ctx.config.maxSteps);
    const summary = await workspaceSummary(this.ctx.ports.fs, this.ctx.workspace, { maxEntries: 80 });
    const profile = await this.loadProfile();

    try {
      const result = await this.gateway.call({
        purpose: 'replan',
        system: plannerSystemPrompt({
          intent,
          workspaceSummary: summary,
          granularity,

          toolNames: this.toolNames,
          revision: { reason: revision.reason, previousTitles: revision.previousTitles },
          directives: this.ctx.presetDirectives,
          profile,
        }),
        messages: [{ role: 'user', content: 'Produce the revised plan now.' }],
        responseFormat: 'json',
        maxTokens: 2_000,
      });

      const raw = extractJsonObject<RawPlan>(result.text);
      const revised = normalisePlan(raw, {
        taskId: this.ctx.taskId,
        maxSteps: granularity.maxSteps,
        mode: plan.mode,
        revision: plan.revision + 1,
      });

      if (!revised) {
        this.ctx.infra.logger.warn('revision produced no usable steps; keeping previous plan');
        return plan;
      }
      const rejected = pathViolations(revised, intent.expectedPaths);
      if (rejected.length > 0) throw new PathEnumError(rejected, intent.expectedPaths);

      this.ctx.infra.metrics.inc('plan.revision_count');
      this.ctx.infra.bus.emit(
        'plan.revised',
        { previousRevision: plan.revision, plan: revised, reason: revision.reason },
        meta,
      );
      return revised;
    } catch (error) {
      if (error instanceof PathEnumError) throw error;
      this.ctx.infra.logger.error('revision failed; keeping previous plan', {
        reason: error instanceof Error ? error.message : String(error),
      });
      return plan;
    }
  }

  private publish(plan: Plan, meta: ReturnType<typeof runMeta>): void {
    this.ctx.infra.metrics.observe('plan.step_count', plan.steps.length);
    this.ctx.infra.metrics.observe('plan.dag_depth', dagDepth(plan.steps));
    this.ctx.infra.bus.emit('plan.ready', { plan }, meta);
  }

  /** One replan. A second off-list path fails the task with the path and the enum. */
  private async replanOffList(
    intent: ClarifiedIntent,
    granularity: ReturnType<typeof granularityFor>,
    summary: string,
    rejected: string[],
    mode: 'fast' | 'full',
    planMode: 'fast' | 'full',
  ): Promise<Plan> {
    const allowed = intent.expectedPaths;
    const profile = await this.loadProfile();
    try {
      const result = await this.gateway.call({
        purpose: 'replan',
        system: plannerSystemPrompt({
          intent,
          workspaceSummary: summary,
          granularity,
          toolNames: this.toolNames,
          revision: {
            reason: `Rejected path ${rejected.join(', ')}. Allowed: ${allowed.join(', ') || '(none)'}`,
            previousTitles: [],
          },
          directives: this.ctx.presetDirectives,
          profile,
        }),
        messages: [{ role: 'user', content: 'Produce a plan that uses only the allowed paths.' }],
        responseFormat: 'json',
        maxTokens: 2_000,
      });
      const revised = normalisePlan(extractJsonObject<RawPlan>(result.text), {
        taskId: this.ctx.taskId,
        maxSteps: granularity.maxSteps,
        mode: planMode || mode,
        revision: 1,
      });
      const again = revised ? pathViolations(revised, allowed) : rejected;
      if (!revised || again.length > 0) throw new PathEnumError(again, allowed);
      return revised;
    } catch (error) {
      if (error instanceof PathEnumError) throw error;
      throw new PathEnumError(rejected, allowed);
    }
  }

  /** `fast` for trivial single-concern tasks, `full` otherwise (whitepaper §5.2). */
  private pickMode(intent: ClarifiedIntent): 'fast' | 'full' {
    if (this.ctx.config.plannerMode !== 'auto') return this.ctx.config.plannerMode;
    const files = intent.expectedPaths.filter((p) => p !== '.');
    const trivial = files.length <= 1 && intent.goal.length < 160;
    return trivial ? 'fast' : 'full';
  }

  /**
   * Load the workspace profile once and reuse it for every planning call in this
   * run. Never throws — the loader logs a missing/unreadable/malformed profile
   * and the loop plans without it (Iteration 24).
   */
  private loadProfile(): Promise<import('../profile/project-profile.js').ProjectProfile | undefined> {
    this.profilePromise ??= loadProfileForWorkspace(
      this.ctx.ports.fs,
      this.ctx.config.profileDir,
      this.ctx.workspace,
      this.ctx.infra.logger,
    );
    return this.profilePromise;
  }
}
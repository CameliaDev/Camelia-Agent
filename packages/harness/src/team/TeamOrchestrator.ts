/**
 * Term team run: one coordinator plan, then workers through SubAgentOrchestrator.
 *
 * Phases follow the task state machine (planning → executing → verifying →
 * delivering). `task.completed` is the caller's job, and only after this returns
 * `done`. A missing plan, an unmet capability, or a team where every worker
 * errored returns `failed` without claiming the work ran.
 * @module
 */

import type { Artifact, ModelInfo, Plan, Step, TaskStatus, Verdict } from '@camelia/core';
import { newId } from '@camelia/core';

import type { RunContext } from '../context/RunContext.js';
import { runMeta } from '../context/RunContext.js';
import type { SubAgentOrchestrator, SubAgentSpec } from '../subagent/SubAgentOrchestrator.js';
import { assignRoleModel } from './assign-roles.js';
import { applyVisionHint, parseTeamWorkers, type TeamWorkerSpec } from './plan.js';

export interface TeamRunDeps {
  ctx: RunContext;
  subAgents: SubAgentOrchestrator;
  catalog: readonly ModelInfo[];
  preferredModel?: string;
  /** Raw coordinator text. The caller owns the model call. */
  planText: (goal: string) => Promise<string>;
  transition: (to: TaskStatus, reason: string) => void;
  /**
   * Plan gate. Called while status is still `planning`; the implementation
   * moves the machine to `awaiting-approval` and, on reject, to `cancelled`.
   */
  approve: (plan: Plan) => Promise<{ ok: true; plan: Plan } | { ok: false; reason: string }>;
  /** When set, pins worker models by role (user-defined team). */
  resolveModel?: (role: string) => string | undefined;
}

export interface TeamRunOutcome {
  status: 'done' | 'failed' | 'cancelled';
  summary: string;
  reason?: string;
  plan: Plan;
  artifacts: Artifact[];
  verdicts: Verdict[];
  /** Workers whose report status was `ok`. */
  workersOk: number;
  workersRan: number;
  /** Workers the work-token gate refused or that handed their token back. Set by `dispatch`. */
  handedBack?: number;
}

export class TeamOrchestrator {
  constructor(private readonly deps: TeamRunDeps) {}

  async run(goal: string): Promise<TeamRunOutcome> {
    const meta = runMeta(this.deps.ctx);
    const empty = this.planFor(goal, []);
    let text: string;
    try {
      text = await this.deps.planText(goal);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return this.failed(empty, `coordinator failed: ${reason}`, 0);
    }

    const parsed = parseTeamWorkers(text);
    if (!parsed.ok) return this.failed(empty, parsed.reason, 0);
    const workers = applyVisionHint(goal, parsed.workers);

    const assigned: { spec: TeamWorkerSpec; modelId: string; reason: string }[] = [];
    const blocked: string[] = [];
    for (const spec of workers) {
      const pinned = this.deps.resolveModel?.(spec.role);
      if (pinned) {
        assigned.push({ spec, modelId: pinned, reason: 'user team preset' });
        continue;
      }
      const pick = assignRoleModel(
        this.deps.catalog,
        {
          requireVision: spec.requireVision,
          minContextTokens: spec.minContextTokens,
          requireTools: spec.requireTools,
        },
        this.deps.preferredModel,
      );
      if (!pick.ok) {
        blocked.push(`${spec.role}: ${pick.reason}`);
        continue;
      }
      assigned.push({ spec, modelId: pick.modelId, reason: pick.reason });
    }
    if (assigned.length !== workers.length) {
      return this.failed(empty, `could not assign every worker. ${blocked.join(' | ')}`, 0);
    }

    const plan = this.planFor(goal, assigned.map((row) => row.spec));
    this.deps.ctx.infra.bus.emit('plan.started', { mode: plan.mode }, meta);
    this.deps.ctx.infra.bus.emit('plan.ready', { plan }, meta);

    const gated = await this.deps.approve(plan);
    if (!gated.ok) {
      return {
        status: 'cancelled',
        summary: gated.reason,
        reason: gated.reason,
        plan,
        artifacts: [],
        verdicts: [],
        workersOk: 0,
        workersRan: 0,
      };
    }

    this.deps.transition('executing', 'workers assigned');
    const specs: SubAgentSpec[] = assigned.map((row) => ({
      goal: row.spec.goal,
      ...(row.spec.focusPaths ? { focusPaths: row.spec.focusPaths } : {}),
      model: row.modelId,
      role: row.spec.role,
    }));
    const reports = await this.deps.subAgents.spawnAll(specs);
    const workersRan = reports.length;
    this.deps.transition('verifying', 'check worker reports');

    const stepId = gated.plan.steps[0]?.id ?? plan.steps[0]?.id ?? this.deps.ctx.taskId;
    this.deps.ctx.infra.bus.emit('verify.started', { stepId, points: reports.length }, meta);
    const verdicts: Verdict[] = [];
    for (const report of reports) {
      const verdict: Verdict = {
        id: newId(),
        stepId,
        taskId: this.deps.ctx.taskId,
        status: report.status === 'ok' ? 'pass' : 'fail',
        evidence: [],
        reason: report.summary.slice(0, 400),
        createdAt: this.deps.ctx.ports.clock.now(),
      };
      verdicts.push(verdict);
      this.deps.ctx.infra.bus.emit('verify.result', { verdict }, meta);
    }

    const workersOk = reports.filter((report) => report.status === 'ok').length;
    const artifacts = reports.flatMap((report) => report.artifacts);
    if (workersRan === 0 || workersOk === 0) {
      const reason = workersRan === 0
        ? 'no worker ran'
        : `workers ran but none succeeded\n${reports.map((report) => `- [${report.status}] ${report.goal}: ${report.summary.slice(0, 200)}`).join('\n')}`;
      return this.failed(gated.plan, reason, workersRan, artifacts, verdicts);
    }

    this.deps.transition('delivering', 'at least one worker succeeded');
    const lines = [
      `Coordinator assigned ${assigned.length} worker(s).`,
      ...assigned.map((row) => `- ${row.spec.role} → ${row.modelId} (${row.reason})`),
      ...reports.map((report) => `- [${report.status}] ${report.goal}: ${report.summary.slice(0, 240)}`),
    ];
    return {
      status: 'done',
      summary: lines.join('\n'),
      plan: gated.plan,
      artifacts,
      verdicts,
      workersOk,
      workersRan,
    };
  }

  /**
   * Assign and spawn workers without the plan-approval state machine.
   *
   * Work chat uses this so a delegation is not a task run. Term keeps `run()`,
   * which still gates the plan. `admit` refuses a worker that has no active
   * work token; that worker is not spawned.
   */
  async dispatch(
    goal: string,
    workers: TeamWorkerSpec[],
    admit?: (spec: SubAgentSpec) => Promise<{ ok: true } | { ok: false; reason: string }>,
  ): Promise<TeamRunOutcome> {
    const empty = this.planFor(goal, []);
    const assigned: { spec: TeamWorkerSpec; modelId: string; reason: string }[] = [];
    const blocked: string[] = [];
    for (const spec of workers) {
      const pinned = this.deps.resolveModel?.(spec.role);
      if (pinned) {
        assigned.push({ spec, modelId: pinned, reason: 'user team preset' });
        continue;
      }
      const pick = assignRoleModel(
        this.deps.catalog,
        {
          requireVision: spec.requireVision,
          minContextTokens: spec.minContextTokens,
          requireTools: spec.requireTools,
        },
        this.deps.preferredModel,
      );
      if (!pick.ok) {
        blocked.push(`${spec.role}: ${pick.reason}`);
        continue;
      }
      assigned.push({ spec, modelId: pick.modelId, reason: pick.reason });
    }
    if (assigned.length !== workers.length) {
      return {
        ...this.failed(empty, `could not assign every worker. ${blocked.join(' | ')}`, 0),
        handedBack: 0,
      };
    }

    const admittedSpecs: SubAgentSpec[] = [];
    const admittedWorkers: TeamWorkerSpec[] = [];
    const refused: string[] = [];
    for (const row of assigned) {
      const spec: SubAgentSpec = {
        goal: row.spec.goal,
        ...(row.spec.focusPaths ? { focusPaths: row.spec.focusPaths } : {}),
        model: row.modelId,
        role: row.spec.role,
      };
      if (admit) {
        const decision = await admit(spec);
        if (!decision.ok) {
          refused.push(`${row.spec.role}: ${decision.reason}`);
          continue;
        }
      }
      admittedSpecs.push(spec);
      admittedWorkers.push(row.spec);
    }
    if (admittedSpecs.length === 0) {
      return {
        ...this.failed(empty, `no worker held a token. ${refused.join(' | ')}`, 0),
        handedBack: refused.length,
      };
    }

    const reports = await this.deps.subAgents.spawnAll(admittedSpecs);
    const workersRan = reports.length;
    const workersOk = reports.filter((report) => report.status === 'ok').length;
    const handedFromReports = reports.filter((report) => report.summary.startsWith('handed back')).length;
    const artifacts = reports.flatMap((report) => report.artifacts);
    const summary = [
      `Coordinator assigned ${admittedSpecs.length} worker(s).`,
      ...assigned
        .filter((row) => admittedWorkers.some((worker) => worker.goal === row.spec.goal))
        .map((row) => `- ${row.spec.role} → ${row.modelId} (${row.reason})`),
      ...refused.map((line) => `- [handed back] ${line}`),
      ...reports.map((report) => `- [${report.status}] ${report.goal}: ${report.summary.slice(0, 240)}`),
    ].join('\n');
    const handedBack = refused.length + handedFromReports;
    const plan = this.planFor(goal, admittedWorkers);

    if (workersRan === 0 || workersOk === 0) {
      return { ...this.failed(plan, summary, workersRan, artifacts), handedBack };
    }
    return {
      status: 'done',
      summary,
      plan,
      artifacts,
      verdicts: [],
      workersOk,
      workersRan,
      handedBack,
    };
  }

  private failed(
    plan: Plan,
    reason: string,
    workersRan: number,
    artifacts: Artifact[] = [],
    verdicts: Verdict[] = [],
  ): TeamRunOutcome {
    return {
      status: 'failed',
      summary: reason,
      reason,
      plan,
      artifacts,
      verdicts,
      workersOk: 0,
      workersRan,
    };
  }

  private planFor(goal: string, workers: TeamWorkerSpec[]): Plan {
    const now = this.deps.ctx.ports.clock.now();
    const steps: Step[] = workers.map((worker, idx) => ({
      id: newId(),
      taskId: this.deps.ctx.taskId,
      idx,
      title: worker.role,
      goal: worker.goal,
      status: 'pending',
      acceptance: [
        {
          id: newId(),
          description: 'Worker returns a report',
          kind: 'manual',
          params: {},
        },
      ],
      weight: 1,
      deps: [],
    }));
    if (steps.length === 0) {
      steps.push({
        id: newId(),
        taskId: this.deps.ctx.taskId,
        idx: 0,
        title: 'coordinate',
        goal,
        status: 'pending',
        acceptance: [],
        weight: 1,
        deps: [],
      });
    }
    return {
      id: newId(),
      taskId: this.deps.ctx.taskId,
      steps,
      mode: 'fast',
      revision: 1,
      createdAt: now,
    };
  }
}

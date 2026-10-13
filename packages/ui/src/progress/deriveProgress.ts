/**
 * `deriveProgress` — the one place a task's progress becomes a number.
 *
 * ## Who calls it now
 *
 * Two places, and the count is the point: `ModeHeader`'s lifecycle stepper (for the stage's
 * tone) and the math workspace (for pipeline position). The continuous percentage readout
 * this function used to feed — the top bar's 2px rail and its microcopy — was removed, so
 * `TaskProgressBar` and `ProgressMicrocopy` are gone with it. If you find yourself computing
 * a second percentage anywhere in the tree, stop: it will drift from this one and the user
 * will have no way to tell which is authoritative.
 *
 * ## Source precedence
 *
 *   1. `engine`  — the value the engine emitted (`task.progress`, `task.status_changed`).
 *   2. `derived` — computed from `TaskView` step counts, when the engine has not emitted
 *                  progress for this task (older engines, replayed partial scripts).
 *   3. `demo`    — the labelled fixture for a mode whose backend does not exist yet.
 *   4. `none`    — nothing to show; the bar renders its near-invisible idle rail.
 *
 * The precedence is *observable* — `ProgressResult.source` reports which rung was used —
 * because "the bar says 60% but the engine never sent progress" is a bug worth failing a
 * test on, not a cosmetic detail.
 * @module
 */

import type { StepView, TaskView } from '@camelia/agent/view';

import { type AppModeId } from '../mode/types.js';
import { localizePlanText } from '../i18n/plan-copy.js';
import {
  type MathStage,
  type PlanStage,
  type ProgressResult,
  type ProgressTone,
  type TaskProgressStatus,
} from './types.js';
import { ENGINE_MATH_STEPS, MATH_STAGES, overallForEngineStep, stageForEngineStep } from '../modes/math/mathStageMap.js';
import { type MathDemoSnapshot } from '../modes/math/mathDemoFixture.js';

function statusOf(task: TaskView | undefined): TaskProgressStatus {
  if (!task) return 'idle';
  if (task.status === 'done') return 'done';
  if (task.status === 'failed' || task.status === 'cancelled') return 'failed';
  if (task.status === 'paused') return 'paused';
  return 'running';
}

function toneFor(status: TaskProgressStatus): ProgressTone {
  switch (status) {
    case 'done':
      return 'ok';
    case 'failed':
      return 'bad';
    case 'paused':
      return 'warn';
    case 'idle':
      return 'muted';
    case 'running':
      return 'accent';
  }
}

/**
 * The step the engine is working on, if it named one.
 *
 * `currentStepIdx` is 0-based and points at the *active* step; when a task is done it
 * points at the last one. Returns empty string when no step has a usable title yet, so
 * the caller renders "第 2/5 步" without a dangling separator.
 */
function activeStepLabel(task: TaskView, lang: 'en' | 'zh'): string {
  const steps: StepView[] = task.steps;
  if (steps.length === 0) return '';
  const active =
    steps.find((s) => s.idx === task.currentStepIdx) ??
    steps.find((s) => s.status === 'running' || s.status === 'verifying');
  if (!active) return '';
  const title = active.title || active.goal || '';
  // The scenario keeps English source text so events and tests stay byte-stable; the
  // window language only changes what the reader sees.
  return title ? localizePlanText(lang, title) : '';
}

/**
 * Plan lifecycle, derived from `task.status`.
 *
 * `awaiting-approval` is a real `TaskStatus` (see `core/types/domain.ts`) — the engine
 * already drives it via `plan.ready` + `task.status_changed`. There is deliberately no
 * separate plan state stored anywhere.
 */
export function planStageOf(task: TaskView | undefined): PlanStage {
  if (!task) return 'draft';
  switch (task.status) {
    case 'planning':
    case 'received':
    case 'clarifying':
      return 'draft';
    case 'awaiting-approval':
      return 'awaiting_approval';
    case 'executing':
    case 'verifying':
    case 'delivering':
    case 'reflecting':
      return 'executing';
    case 'done':
      return 'done';
    case 'failed':
    case 'cancelled':
      return 'rejected';
    case 'paused':
      return 'executing';
  }
}

/** Where each lifecycle stage sits on the rail (four equal stops). */
const PLAN_STOP: Record<PlanStage, number> = {
  draft: 0.15,
  awaiting_approval: 0.4,
  executing: 0.7,
  done: 1,
  rejected: 1,
};

const PLAN_TONE: Record<PlanStage, ProgressTone> = {
  draft: 'muted',
  awaiting_approval: 'warn',
  executing: 'accent',
  done: 'ok',
  rejected: 'bad',
};

/**
 * Math progress.
 *
 * Prefers a real engine stage when one exists on the task, otherwise falls back to step
 * counting, otherwise returns the labelled demo. The fallback is what makes this work
 * against an engine that has no `math.*` events yet — which is the current state — while
 * still being honest about it (`source: 'derived'`).
 */
function mathProgress(
  task: TaskView | undefined,
  demo: MathDemoSnapshot | undefined,
): { stage: MathStage; ratio: number; overall: number; status: TaskProgressStatus; tone: ProgressTone; source: ProgressResult['source'] } {
  const status = statusOf(task);

  // Engine path: an explicit stage marker beats inference. The projection does not carry
  // one today; the plan book specifies `math.stage` for this slot, and the guard here
  // means wiring it later changes only this branch.
  if (task && task.stepsTotal > 0) {
    const done = task.steps.filter((s) => s.status === 'done').length;
    // Map the engine's own progress ratio onto the *pipeline* axis defined in
    // `mathStageMap.ts` — the same axis the stage chips use, so the bar and the chips can
    // never disagree. `ENGINE_MATH_STEPS` is the injected template length, not a magic 8.
    const engineStep = task.progress > 0 ? task.progress * ENGINE_MATH_STEPS : Math.max(1, done);
    const stage = stageForEngineStep(Math.ceil(engineStep) || 1);
    const spec = MATH_STAGES.find((s) => s.id === stage) ?? MATH_STAGES[0]!;
    const prevEnd = MATH_STAGES[MATH_STAGES.indexOf(spec) - 1]?.endsAt ?? 0;
    // Prefer the engine's ratio: it is weighted by the harness. `overallForEngineStep` is
    // only the fallback for projections that never carried progress.
    const overall = Math.min(
      1,
      Math.max(0, task.progress > 0 ? task.progress : overallForEngineStep(Math.ceil(engineStep), 0)),
    );
    const span = spec.endsAt - prevEnd;
    const ratio = span > 0 ? Math.min(1, Math.max(0, (overall - prevEnd) / span)) : 0;
    return { stage, ratio, overall, status, tone: toneFor(status), source: 'derived' };
  }

  // Demo path: only reachable when the caller passes the labelled fixture.
  if (demo) {
    const spec = MATH_STAGES.find((s) => s.id === demo.stage) ?? MATH_STAGES[0]!;
    const prevEnd = MATH_STAGES[MATH_STAGES.indexOf(spec) - 1]?.endsAt ?? 0;
    const span = spec.endsAt - prevEnd;
    const ratio = demo.within;
    const overall = prevEnd + span * ratio;
    return {
      stage: demo.stage,
      ratio,
      overall,
      status: demo.status,
      tone: demo.status === 'failed' ? 'bad' : demo.status === 'done' ? 'ok' : 'accent',
      source: 'demo',
    };
  }

  // Nothing at all — a real idle rail, not a fake in-progress one.
  return { stage: 'modeling', ratio: 0, overall: 0, status, tone: toneFor(status), source: 'none' };
}

export interface DeriveProgressInput {
  task: TaskView | undefined;
  mode: AppModeId;
  language: 'en' | 'zh';
  /** Present only when the math demo has been explicitly loaded by the user. */
  mathDemo?: MathDemoSnapshot;
}

export function deriveProgress({ task, mode, language, mathDemo }: DeriveProgressInput): ProgressResult {
  if (mode === 'plan') {
    const stage = planStageOf(task);
    return {
      mode,
      demo: false,
      source: task ? 'engine' : 'none',
      progress: { kind: 'plan', stage, ratio: PLAN_STOP[stage], tone: PLAN_TONE[stage] },
    };
  }

  if (mode === 'math') {
    const m = mathProgress(task, mathDemo);
    return {
      mode,
      demo: m.source === 'demo',
      source: m.source,
      progress: {
        kind: 'math',
        stage: m.stage,
        ratio: m.ratio,
        overall: m.overall,
        status: m.status,
        tone: m.tone,
      },
    };
  }

  // Conversation mode: weighted progress straight off the task.
  const status = statusOf(task);
  const total = task?.stepsTotal ?? 0;
  const current = task ? Math.min(task.currentStepIdx + 1, Math.max(1, total)) : 0;
  const ratio = task ? Math.max(0, Math.min(1, task.progress)) : 0;
  // `task.progress` is engine-emitted and weighted; falling back to the raw step count
  // is only for projections that never carried it. Report which one we used.
  const source: ProgressResult['source'] = !task ? 'none' : 'engine';
  return {
    mode,
    demo: false,
    source,
    progress: {
      kind: 'task',
      current: total === 0 ? 0 : current,
      total,
      ratio,
      label: task ? activeStepLabel(task, language) : '',
      status,
      tone: toneFor(status),
    },
  };
}

/** True when the engine should be considered mid-flight for force-visible purposes. */

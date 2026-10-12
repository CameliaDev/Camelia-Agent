/**
 * The progress model — one shape, three modes.
 *
 * The UI has exactly **one** progress derivation (`deriveProgress`) and both the top bar
 * and the activity bar render from its output. That is not a stylistic preference: with
 * two derivations, the header and the task strip can disagree about which step is running,
 * and there is no way to tell the user which one is right.
 *
 * Every variant is derived from fields the engine already emits. Nothing here invents a
 * stage the projection cannot support — see `deriveProgress.ts` for how each field maps
 * back to a real event.
 * @module
 */

import type { AppModeId } from '../mode/types.js';

/** Tone vocabulary shared with `lib/status.ts` (kept as a string union to avoid a cycle). */
export type ProgressTone = 'ok' | 'bad' | 'warn' | 'info' | 'accent' | 'muted';

export type TaskProgressStatus = 'idle' | 'running' | 'paused' | 'done' | 'failed';

/** Conversation mode: weighted step progress from `task.progress`. */
export interface TaskProgress {
  kind: 'task';
  /** 1-based step number, clamped for display. */
  current: number;
  total: number;
  /** 0..1. Comes from the engine, never recomputed from `current/total`. */
  ratio: number;
  /** Already-localised step label, or empty when the engine has not named one. */
  label: string;
  status: TaskProgressStatus;
  tone: ProgressTone;
}

/**
 * Plan mode: the plan's lifecycle.
 *
 * Derived from `task.status`, which the engine already drives
 * (`plan.ready` → `task.status_changed → 'awaiting-approval'` → `'executing'`). There is
 * no `plan.approved` event and no `awaiting_approval` status — see the plan book §5.
 */
export type PlanStage = 'draft' | 'awaiting_approval' | 'executing' | 'done' | 'rejected';

export interface PlanProgress {
  kind: 'plan';
  stage: PlanStage;
  /** 0..1 across the four lifecycle stops. */
  ratio: number;
  tone: ProgressTone;
}

/**
 * Math mode: the four-stage compression of the engine's 8-step modeling pipeline.
 *
 * The engine's pipeline (`prompts/math-modeling.ts`) is: 问题重述 → 模型假设 → 变量与符号
 * → 建立模型 → 求解 → 校验 → 灵敏度 → 报告. The UI compresses those eight into four
 * visible stages; `mathStageMap.ts` owns the mapping so the two can never drift.
 */
export type MathStage = 'modeling' | 'solving' | 'verifying' | 'reporting';

export interface MathProgress {
  kind: 'math';
  stage: MathStage;
  /** 0..1 within the current stage. */
  ratio: number;
  /** 0..1 across the whole pipeline, for the top bar's thin rail. */
  overall: number;
  status: TaskProgressStatus;
  tone: ProgressTone;
}

export type ProgressModel = TaskProgress | PlanProgress | MathProgress;

/** A mode's progress plus whether it is real or demonstration data. */
export interface DerivedProgress {
  progress: ProgressModel;
  /**
   * True when this is demo data rather than engine state.
   *
   * Anything rendering with `demo: true` **must** show a visible 演示 badge. This is the
   * one flag that keeps a screenshot of an unbuilt feature from being mistaken for a
   * working one.
   */
  demo: boolean;
}

/** Where the numbers came from — surfaced in tests and in the plan book. */
export type ProgressSource = 'engine' | 'derived' | 'demo' | 'none';

export interface ProgressResult extends DerivedProgress {
  source: ProgressSource;
  mode: AppModeId;
}

/**
 * The math-modeling stage map — the single bridge between the engine's injected pipeline
 * and the UI's four visible stages.
 *
 * ## Why this file exists
 *
 * `packages/harness/src/prompts/math-modeling.ts` defines the authoritative pipeline. It
 * exports two things, and only one of them is used:
 *
 * - `MATH_MODELING_SYSTEM_SUFFIX` — a prose 8-item process description. **Nothing imports
 *   it.** It is a prompt suffix, not a step list.
 * - `MATH_MODELING_STEP_TEMPLATE` — **7 steps**, and this is what
 *   `packages/harness/src/prompts/system.ts:167` actually injects into the planner as the
 *   numbered plan skeleton.
 *
 * The UI must map onto the *injected* pipeline (7), not the prose description (8), or it
 * will claim a step axis the engine never walks.
 *
 * The math workspace shows four stages because seven chips do not fit in a top bar and
 * four reads as a lifecycle. But a compression that lives only in JSX silently drifts: add
 * an eighth template entry and the progress bar would keep claiming 100%. So the mapping is
 * data, in one place, and `test/math-stage-map.test.ts` reads the harness source to prove
 * the union still covers it — that test is what makes this file safe to trust.
 * @module
 */

import type { MathStage } from '../../progress/types.js';

export interface MathStageSpec {
  id: MathStage;
  /** i18n key for the stage chip. */
  labelKey: string;
  /** i18n key for the sub-line shown while the stage is active. */
  hintKey: string;
  /**
   * The injected pipeline step numbers this stage covers (1-based, matching
   * `MATH_MODELING_STEP_TEMPLATE` order). A test asserts the union is exactly 1..7.
   */
  engineSteps: readonly number[];
  /**
   * Progress fraction at the *end* of this stage, 0..1.
   *
   * Weighted by step count (3/7, 4/7, 6/7, 7/7) rather than four equal quarters, so the
   * bar advances in proportion to the work the engine does. This table is the fallback
   * axis; when the engine emits `math.stage` with a real ratio, that value takes over.
   */
  endsAt: number;
}

/** Step count of the pipeline the harness actually injects. Asserted against the source. */
export const ENGINE_MATH_STEPS = 7;

export const MATH_STAGES: readonly MathStageSpec[] = [
  {
    id: 'modeling',
    labelKey: 'progress.math.modeling',
    hintKey: 'math.hint.modeling',
    // 1 restate · 2 assumptions+symbols · 3 build the model
    engineSteps: [1, 2, 3],
    endsAt: 3 / ENGINE_MATH_STEPS,
  },
  {
    id: 'solving',
    labelKey: 'progress.math.solving',
    hintKey: 'math.hint.solving',
    // 4 solve with math.exec and plot
    engineSteps: [4],
    endsAt: 4 / ENGINE_MATH_STEPS,
  },
  {
    id: 'verifying',
    labelKey: 'progress.math.verifying',
    hintKey: 'math.hint.verifying',
    // 5 verify on a special case · 6 sensitivity ±10%
    engineSteps: [5, 6],
    endsAt: 6 / ENGINE_MATH_STEPS,
  },
  {
    id: 'reporting',
    labelKey: 'progress.math.reporting',
    hintKey: 'math.hint.reporting',
    // 7 final Chinese report
    engineSteps: [7],
    endsAt: 1,
  },
];

export function stageSpec(stage: MathStage): MathStageSpec {
  return MATH_STAGES.find((s) => s.id === stage) ?? MATH_STAGES[0]!;
}

/** 0-based index of a stage, for "stage 2 of 4" copy. */
export function stageIndex(stage: MathStage): number {
  const idx = MATH_STAGES.findIndex((s) => s.id === stage);
  return idx < 0 ? 0 : idx;
}

/**
 * Map an injected pipeline step number (1..7) to the UI stage covering it.
 *
 * Clamped before lookup: a planner may emit more or fewer steps than the template, and an
 * unclamped lookup would fall through to the first stage — making a nearly-finished run
 * look like it had just started.
 */
export function stageForEngineStep(step: number): MathStage {
  const clamped = Math.min(ENGINE_MATH_STEPS, Math.max(1, Math.floor(step)));
  const found = MATH_STAGES.find((s) => s.engineSteps.includes(clamped));
  return found?.id ?? 'modeling';
}

/**
 * Fraction of the pipeline complete when the engine sits at `step` (1..7) at `within`
 * (0..1) of that step. Used for the fallback path and by the demo fixture.
 */
export function overallForEngineStep(step: number, within = 0): number {
  const clampedStep = Math.min(ENGINE_MATH_STEPS, Math.max(1, Math.floor(step)));
  const prevEnd = clampedStep === 1 ? 0 : (clampedStep - 1) / ENGINE_MATH_STEPS;
  const end = clampedStep / ENGINE_MATH_STEPS;
  const w = Math.max(0, Math.min(1, within));
  return prevEnd + (end - prevEnd) * w;
}

/**
 * The math-mode demonstration fixture.
 *
 * ## Why this file is allowed to exist
 *
 * The engine has no `math.*` commands (verified: `EngineServer` handles no math case), so
 * a math workspace with no data would be an empty room and the UI work could not be
 * reviewed. This fixture supplies *labelled* data so the interaction, layout and stage
 * progression can be judged before the backend exists.
 *
 * ## The rule it must never break
 *
 * Everything from here renders with a visible **演示** badge, and the mode itself is
 * `available: false` in the registry. Loading the demo is an explicit user action — it
 * never auto-plays on entering math mode, because an animation that starts by itself
 * reads as "the solver is connected".
 *
 * `demoOverlay` lives in the store's own field and is never folded into `snapshot`, so
 * projection replay can never be contaminated by it.
 * @module
 */

import type { MathStage } from '../../progress/types.js';
import { ENGINE_MATH_STEPS, MATH_STAGES, stageIndex } from './mathStageMap.js';

export interface MathDemoVariable {
  symbol: string;
  name: string;
  unit: string;
  /** Shown as the fitted / assumed value. */
  value: string;
  source: 'assumption' | 'fitted' | 'user' | 'derived';
}

export interface MathDemoAssumption {
  text: string;
  /** `pending` items render with a "待定" chip rather than silently looking settled. */
  state: 'confirmed' | 'pending';
}

export interface MathDemoEquation {
  /** Plain-text form. LaTeX rendering is a follow-up; see the plan book §6. */
  text: string;
  note: string;
}

export interface MathDemoResultCard {
  label: string;
  value: string;
  unit?: string;
  hint?: string;
}

export interface MathDemoSnapshot {
  stage: MathStage;
  /** 0..1 within the current stage. */
  within: number;
  status: 'idle' | 'running' | 'done' | 'failed';
  /** Pipeline throughput lines, standing in for `math.exec` stdout. */
  solverLog: string[];
  assumptions: MathDemoAssumption[];
  variables: MathDemoVariable[];
  equations: MathDemoEquation[];
  results: MathDemoResultCard[];
  /** UI-stage name → the engine pipeline steps it covers, for the stage strip. */
  engineStepHint: string;
}

/** A short SIR epidemic model — small enough to read, rich enough to look real. */
const ASSUMPTIONS: MathDemoAssumption[] = [
  { text: '总人口 N 恒定，不考虑出生与死亡', state: 'confirmed' },
  { text: '感染者与易感者充分混合（均匀混合假设）', state: 'confirmed' },
  { text: '康复者获得永久免疫，不再进入易感态', state: 'pending' },
  { text: '潜伏期可忽略，感染即具传染性', state: 'pending' },
];

const VARIABLES: MathDemoVariable[] = [
  { symbol: 'N', name: '总人口', unit: '人', value: '1.0×10⁶', source: 'user' },
  { symbol: 'S(t)', name: '易感者数量', unit: '人', value: '9.99×10⁵', source: 'derived' },
  { symbol: 'I(t)', name: '感染者数量', unit: '人', value: '1.0×10³', source: 'user' },
  { symbol: 'R(t)', name: '康复者数量', unit: '人', value: '0', source: 'derived' },
  { symbol: 'β', name: '传染率', unit: '1/天', value: '0.42', source: 'fitted' },
  { symbol: 'γ', name: '恢复率', unit: '1/天', value: '0.14', source: 'assumption' },
];

const EQUATIONS: MathDemoEquation[] = [
  { text: 'dS/dt = −β·S·I / N', note: '易感者被感染的速率' },
  { text: 'dI/dt = β·S·I / N − γ·I', note: '感染者净变化' },
  { text: 'dR/dt = γ·I', note: '康复累积' },
  { text: 'S + I + R = N', note: '守恒约束，用于校验' },
];

const RESULTS: MathDemoResultCard[] = [
  { label: '基本再生数 R₀', value: '3.00', hint: 'β/γ — 大于 1 意味着疫情扩散' },
  { label: '峰值感染日', value: '第 42 天', hint: 'dI/dt = 0 的数值解' },
  { label: '峰值感染人数', value: '2.31×10⁵', unit: '人', hint: '占人口 23.1%' },
  { label: '最终累计感染', value: '8.94×10⁵', unit: '人', hint: 't → ∞ 的数值外推' },
];

const SOLVER_LOG = [
  '--- python ok ---',
  'sympy 1.13.1 · numpy 2.1.3 · scipy 1.14.1',
  'odeint: 采样 1000 点, 区间 [0, 160] 天',
  'residual(max) = 3.1e-09  →  收敛',
  'figure → .camelia/math/sir_demo.png',
];

/**
 * The stage each pipeline step lands in, for the strip's tooltip.
 *
 * The total comes from `ENGINE_MATH_STEPS`, never a literal: this line previously read
 * "共 8 步" from when the UI wrongly mapped onto the unused 8-item prose suffix. A
 * hardcoded total is exactly the kind of detail that goes stale silently in a demo.
 */
function hintFor(stage: MathStage): string {
  const spec = MATH_STAGES.find((s) => s.id === stage) ?? MATH_STAGES[0]!;
  return `引擎步骤 ${spec.engineSteps.join('/')} · 共 ${ENGINE_MATH_STEPS} 步`;
}

/** Build the demo snapshot at a given stage, so a caller can step through it. */
export function mathDemoAt(stage: MathStage, within = 0.5, status: MathDemoSnapshot['status'] = 'running'): MathDemoSnapshot {
  return {
    stage,
    within: Math.max(0, Math.min(1, within)),
    status,
    solverLog: status === 'idle' ? [] : SOLVER_LOG.slice(0, Math.max(1, stageIndex(stage) + 2)),
    assumptions: ASSUMPTIONS,
    variables: VARIABLES,
    equations: EQUATIONS,
    results: status === 'idle' ? [] : RESULTS,
    engineStepHint: hintFor(stage),
  };
}

/**
 * The full progression a user sees after pressing 加载演示课题.
 *
 * Four frames, one per UI stage, so stepping is deterministic and screenshottable. The
 * frames are data, not a timer: the workspace walks them on an interval, and a test can
 * assert the sequence without waiting on wall-clock time.
 */
export const MATH_DEMO_FRAMES: readonly MathDemoSnapshot[] = [
  mathDemoAt('modeling', 0.35, 'running'),
  mathDemoAt('modeling', 1, 'running'),
  mathDemoAt('solving', 0.6, 'running'),
  mathDemoAt('solving', 1, 'running'),
  mathDemoAt('verifying', 0.5, 'running'),
  mathDemoAt('verifying', 1, 'running'),
  mathDemoAt('reporting', 0.75, 'running'),
  mathDemoAt('reporting', 1, 'done'),
];

export const MATH_DEMO_FIRST: MathDemoSnapshot = MATH_DEMO_FRAMES[0]!;
export const MATH_DEMO_LAST: MathDemoSnapshot = MATH_DEMO_FRAMES[MATH_DEMO_FRAMES.length - 1]!;

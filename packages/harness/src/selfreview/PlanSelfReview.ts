/**
 * Plan self-review — "think before acting" (Iteration 20).
 *
 * A deterministic, cheap four-question review of a produced plan:
 *
 *   1. scope        — does it stay inside the authorised range?
 *   2. contract     — does it threaten existing tests or architecture contracts?
 *   3. simplicity   — is there a plainly simpler path?
 *   4. verifiability— are acceptance points objectively machine-checkable?
 *
 * It runs at exactly three decision points (planning complete / verification
 * failed / reflection) and is *skipped* for fast-path plans (whitepaper: plan
 * overhead must not drag down the 95% success target). The result is emitted as
 * a `selfreview.performed` event, so it is observable and replayable.
 *
 * The review is deliberately model-free: it is a guard, not a judgement — every
 * question returns pass / warn / fail with evidence, and only hard `fail`s force
 * a `revise` verdict.
 * @module
 */

import type { ClarifiedIntent, Plan } from '@camelia/core';

export type SelfReviewDecisionPoint = 'planning' | 'verification-fail' | 'reflect';

export type SelfReviewQuestionId = 'scope' | 'contract' | 'simplicity' | 'verifiability';

export interface SelfReviewQuestion {
  id: SelfReviewQuestionId;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
}

export interface SelfReviewResult {
  decisionPoint: SelfReviewDecisionPoint;
  verdict: 'approve' | 'revise';
  mode: Plan['mode'];
  planId: Plan['id'];
  questions: SelfReviewQuestion[];
}

/** Patterns that suggest a step intends to change tests or core contracts. */
const CONTRACT_SIGNALS = [
  /(^|[\\/])test([\\/]|$)/i,
  /(^|[\\/])tests([\\/]|$)/i,
  /\.spec\./i,
  /\.test\./i,
  /(^|[\\/])__tests__([\\/]|$)/i,
  /packages[\\/]core[\\/]/,
  /types[\\/]domain\.ts/,
];

const MACHINE_KINDS = new Set(['file-exists', 'file-contains', 'command-exit-zero', 'test-pass', 'diff-nonempty']);

export class PlanSelfReview {
  /** Fast-path plans are exempt — a one-step task must not pay planning tax. */
  shouldReview(plan: Plan): boolean {
    return plan.mode !== 'fast';
  }

  review(decisionPoint: SelfReviewDecisionPoint, plan: Plan, intent: ClarifiedIntent): SelfReviewResult {
    const questions: SelfReviewQuestion[] = [
      this.qScope(plan, intent),
      this.qContract(plan),
      this.qSimplicity(plan, intent),
      this.qVerifiability(plan),
    ];
    const verdict: SelfReviewResult['verdict'] = questions.some((q) => q.status === 'fail')
      ? 'revise'
      : 'approve';
    return { decisionPoint, verdict, mode: plan.mode, planId: plan.id, questions };
  }

  /** ① 是否超出授权范围？ */
  private qScope(plan: Plan, intent: ClarifiedIntent): SelfReviewQuestion {
    const expected = new Set(intent.expectedPaths.map((p) => p.replace(/[\\/]+$/, '')));
    const outside: string[] = [];
    const constraintHits: string[] = [];
    for (const step of plan.steps) {
      const haystack = `${step.title} ${step.goal ?? ''}`.toLowerCase();
      for (const acceptance of step.acceptance) {
        const path = typeof acceptance.params.path === 'string' ? acceptance.params.path : '';
        if (path && expected.size > 0 && !expected.has(path.replace(/[\\/]+$/, ''))) {
          outside.push(path);
        }
      }
      for (const constraint of intent.constraints) {
        const keywords = constraint.toLowerCase().split(/[\s,，、]+/).filter((word) => word.length > 1);
        if (keywords.some((word) => haystack.includes(word))) constraintHits.push(constraint);
      }
    }
    if (constraintHits.length > 0) {
      return {
        id: 'scope',
        status: 'fail',
        detail: `Plan appears to violate stated constraints: ${constraintHits.slice(0, 3).join('; ')}`,
      };
    }
    if (outside.length > 0) {
      return {
        id: 'scope',
        status: 'warn',
        detail: `Acceptance paths outside the declared expected paths: ${outside.slice(0, 3).join(', ')}`,
      };
    }
    return { id: 'scope', status: 'pass', detail: 'All acceptance paths stay inside the authorised range.' };
  }

  /** ② 是否破坏既有测试或契约？ */
  private qContract(plan: Plan): SelfReviewQuestion {
    const hits: string[] = [];
    for (const step of plan.steps) {
      let haystack = `${step.title} ${step.goal ?? ''}`;
      for (const acceptance of step.acceptance) {
        if (typeof acceptance.params.path === 'string') haystack += ` ${acceptance.params.path}`;
      }
      for (const signal of CONTRACT_SIGNALS) {
        if (signal.test(haystack)) {
          hits.push(step.title);
          break;
        }
      }
    }
    if (hits.length > 0) {
      return {
        id: 'contract',
        status: 'warn',
        detail: `Steps touch tests or core contracts — confirm the intent authorises them: ${hits.slice(0, 3).join('; ')}`,
      };
    }
    return { id: 'contract', status: 'pass', detail: 'No test or contract surface is touched.' };
  }

  /** ③ 是否有更简单的路径？ */
  private qSimplicity(plan: Plan, intent: ClarifiedIntent): SelfReviewQuestion {
    const steps = plan.steps.length;
    const files = intent.expectedPaths.length;
    if (steps > 1 && files > 0 && steps > files + 2) {
      return {
        id: 'simplicity',
        status: 'warn',
        detail: `${steps} steps for ${files} expected file(s) — consider folding steps together.`,
      };
    }
    if (steps > 1) {
      const targets = new Set<string>();
      for (const step of plan.steps) {
        for (const acceptance of step.acceptance) {
          if (typeof acceptance.params.path === 'string') targets.add(acceptance.params.path);
        }
      }
      if (targets.size === 1 && files <= 1) {
        return {
          id: 'simplicity',
          status: 'warn',
          detail: `${steps} steps all target "${[...targets][0]}" — a single step would do.`,
        };
      }
    }
    return { id: 'simplicity', status: 'pass', detail: 'Step count is proportional to the expected surface.' };
  }

  /** ④ 验收点是否客观可验证？ */
  private qVerifiability(plan: Plan): SelfReviewQuestion {
    const blind: string[] = [];
    for (const step of plan.steps) {
      if (step.acceptance.length === 0) {
        blind.push(step.title);
        continue;
      }
      if (step.acceptance.every((point) => !MACHINE_KINDS.has(point.kind))) blind.push(step.title);
    }
    if (blind.length > 0) {
      return {
        id: 'verifiability',
        status: 'fail',
        detail: `Steps have no machine-checkable acceptance point: ${blind.slice(0, 3).join('; ')}`,
      };
    }
    return { id: 'verifiability', status: 'pass', detail: 'Every step has an objective, machine-checkable acceptance point.' };
  }
}

/** Render a self-review result as a one-line audit string. */
export function renderSelfReview(result: SelfReviewResult): string {
  const statuses = result.questions.map((q) => `${q.id}:${q.status}`).join(' ');
  return `${result.decisionPoint} ${result.verdict} (${statuses})`;
}

/** Bounded human-readable concerns, for pinning into context. */
export function selfReviewConcerns(result: SelfReviewResult): string {
  return result.questions
    .filter((q) => q.status === 'fail')
    .map((q) => `${q.id}: ${q.detail}`)
    .join(' | ')
    .slice(0, 400);
}

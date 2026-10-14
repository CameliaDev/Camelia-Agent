/**
 * Cognitive policy (ARCH-COGNITION §5.3).
 *
 * Pure: no model, no randomness, no hidden state. The five decision paths in
 * §3.5 are not armed here. Phase 2 returns `proceed` for every input so an
 * observe-mode estimator cannot change a plan, a model choice, or a tool call.
 * Phase 4 is what may return anything else, and only after the Phase 0 gate
 * and the §6.3 recovery/rollback gaps.
 * @module
 */

import type { CognitiveAction, Prediction, PredictionContext, Residual } from '@camelia/core';

export interface CognitivePolicy {
  /** 动作之前：由预测推导出要不要改变计划。 */
  beforeStep(prediction: Prediction | undefined, ctx: PredictionContext): CognitiveAction;
  /** 动作之后：由残差推导出要不要复核。 */
  afterResidual(residual: Residual | undefined, ctx: PredictionContext): CognitiveAction;
}

/** The only policy shipped with Phase 2. Every branch is `proceed`. */
export class ObserveOnlyPolicy implements CognitivePolicy {
  beforeStep(_prediction: Prediction | undefined, _ctx: PredictionContext): CognitiveAction {
    return { kind: 'proceed' };
  }

  afterResidual(_residual: Residual | undefined, _ctx: PredictionContext): CognitiveAction {
    return { kind: 'proceed' };
  }
}

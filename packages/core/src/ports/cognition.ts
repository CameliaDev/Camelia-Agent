/**
 * Cognition port — predict before acting, score after observing.
 *
 * The interface lives in `core`; the estimator lives in `harness` and is
 * injected by `agent` (whitepaper §2.2). Every method may return a value that
 * means "not running": callers keep the previous behaviour. The mechanism is
 * a bypass that is allowed to be off or to fail, and it must not fail the loop.
 * @module
 */

import type { Id, Timestamp } from '../types/common.js';
import type {
  CompetenceReport,
  Observable,
  ObservedValue,
  Prediction,
  Residual,
  SituationSignature,
  Uncertainty,
} from '../types/cognition.js';
import type { Plan, ProviderCapabilities, Step } from '../types/domain.js';

export interface PredictionContext {
  readonly taskId: Id;
  readonly sessionId: Id;
  readonly workspace: string;
  readonly stepId?: Id;
  readonly capabilities: ProviderCapabilities;
  readonly model: string;
  readonly step: Step;
  readonly plan: Plan;
  readonly now: number;
}

export interface CognitionPort {
  /**
   * 在动作之前作出承诺。
   * 返回 undefined 表示本机制已关闭或该可观察量不值得预测——
   * 调用方必须容忍 undefined，并在没有预测时按原逻辑继续。
   */
  predict(
    subject: Observable,
    signature: SituationSignature,
    ctx: PredictionContext,
  ): Promise<Prediction | undefined>;

  /**
   * 把观察结算成残差，并更新统计表。
   * 没有对应预测时返回 undefined（不报错）——这是常态，
   * 例如任务在预测之后被用户取消。
   */
  observe(
    subject: Observable,
    observed: ObservedValue,
    ctx: PredictionContext,
  ): Promise<Residual | undefined>;

  /** 某一签名（或其回退链）的胜任度。 */
  competence(filter: CompetenceQuery): Promise<CompetenceReport>;

  /** 候选可观察量中不确定度最高、成本最低的若干个，供探测路径使用。 */
  mostUncertain(
    candidates: readonly Observable[],
    ctx: PredictionContext,
    limit: number,
  ): Promise<readonly Uncertainty[]>;
}

export interface CompetenceQuery {
  readonly signatureKey?: string;
  readonly workspace?: string;
  readonly taskId?: Id;
  readonly since?: Timestamp;
  readonly limit?: number;
}

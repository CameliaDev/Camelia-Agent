/**
 * Cognition types — the prediction–error loop (ARCH-COGNITION §5.1).
 *
 * A prediction is not a fact. `Prediction` / `Residual` are distinct from
 * `Verdict` / `Evidence`: different types, different events, different tables.
 * An unconfirmed estimate must never be readable as a confirmed result.
 * @module
 */

import type { Id, Timestamp } from './common.js';

/* ─────────────── 情境 ─────────────── */

export type CapabilityClass = 'tool-calling' | 'text-tool-calls' | 'no-tools';
export type StepArchetype = 'read' | 'write' | 'edit' | 'exec' | 'verify' | 'research';
export type ScopeClass = 'single-file' | 'few-files' | 'many-files' | 'unknown';

export interface SituationSignature {
  readonly capability: CapabilityClass;
  readonly archetype: StepArchetype;
  readonly scope: ScopeClass;
  readonly toolset: readonly string[];
  readonly inDegree: number;
}

/* ─────────────── 被预测的可观察量 ─────────────── */

export type Observable =
  | { readonly kind: 'verdict'; readonly stepId: Id }
  | { readonly kind: 'tool-outcome'; readonly tool: string }
  | { readonly kind: 'tool-call-count'; readonly stepId: Id }
  | { readonly kind: 'duration-ms'; readonly stepId: Id }
  | { readonly kind: 'cost-usd'; readonly taskId: Id }
  | { readonly kind: 'touched-paths'; readonly stepId: Id }
  | { readonly kind: 'failure-mode'; readonly workspace: string };

export type ObservableKind = Observable['kind'];

/* ─────────────── 预测 ─────────────── */

export type PredictionValue =
  | { readonly kind: 'categorical'; readonly p: number; readonly label: string }
  | { readonly kind: 'categorical-multi'; readonly probs: Readonly<Record<string, number>> }
  | { readonly kind: 'numeric'; readonly value: number; readonly unit: string }
  | { readonly kind: 'set'; readonly items: readonly string[] };

export type PredictionSource =
  | 'empirical-backoff' // 分层统计表（主路径）
  | 'prior' // 冷启动先验（quality / failure_modes / difficultyScore）
  | 'model' // 显式询问过模型（昂贵，默认关闭，见 §7.4）
  | 'user'; // 用户在干预里陈述的期望

export interface Prediction {
  readonly id: Id;
  readonly taskId: Id;
  readonly sessionId: Id;
  readonly stepId?: Id;
  readonly subject: Observable;
  readonly signature: SituationSignature;
  readonly signatureKey: string; // 规范化后的回退键
  readonly value: PredictionValue;
  /** 0..1：对「这个预测本身有多可信」的自评，用于校准诊断，不用于评分。 */
  readonly confidence: number;
  readonly source: PredictionSource;
  /** 人类可读依据，例如 "L2 n=12, pass 9/12" 或 "prior: quality 0.40"。 */
  readonly basis: string;
  /** 产生此预测的层，便于诊断。 */
  readonly level: number;
  readonly at: Timestamp;
}

/* ─────────────── 观察 ─────────────── */

export type ObservedValue =
  | { readonly kind: 'categorical'; readonly label: string }
  | { readonly kind: 'numeric'; readonly value: number }
  | { readonly kind: 'set'; readonly items: readonly string[] };

/* ─────────────── 残差 ─────────────── */

export type ScoringRule = 'brier' | 'categorical-brier' | 'nrmse' | 'jaccard';

/**
 * 一次预测的结算。
 *
 * `score` 与 `surprise` 分开存：score 是连续的原始信号（用于统计与校准），
 * surprise 是离散的、经过阈值判断后的行为触发器。混为一谈会让
 * "阈值调整" 变成 "重新计算历史"，而历史必须不可变。
 */
export interface Residual {
  readonly predictionId: Id;
  readonly taskId: Id;
  readonly signatureKey: string;
  readonly observed: ObservedValue;
  readonly score: number; // 0..1
  readonly rule: ScoringRule;
  readonly surprise: boolean;
  /** 判定惊讶时所用的阈值；冷启动或先验预测时为 null。 */
  readonly threshold: number | null;
  /** 人类可读对照："expected pass (0.75) → observed fail"。 */
  readonly contrast: string;
  readonly at: Timestamp;
}

/* ─────────────── 决策 ─────────────── */

export type CognitiveAction =
  | { readonly kind: 'proceed' }
  | { readonly kind: 'add-verification'; readonly stepId: Id; readonly reason: string }
  | { readonly kind: 'split-step'; readonly stepId: Id; readonly reason: string }
  | { readonly kind: 'use-decision-model'; readonly stepId: Id; readonly reason: string }
  | { readonly kind: 'reverify'; readonly stepId: Id; readonly reason: string }
  | { readonly kind: 'probe'; readonly probe: Observable; readonly reason: string }
  | { readonly kind: 'ask-user'; readonly question: string; readonly reason: string };

/**
 * How far the loop may let a residual change behaviour.
 *
 * The default is `'observe'`: record predictions and residuals, change nothing.
 * Persisted as a window preference (`localPrefs`), not as snapshot state.
 */
export type CognitionMode = 'off' | 'observe' | 'advise' | 'drive';

/** Default until calibration is demonstrated. The loop must not act on residuals. */
export const DEFAULT_COGNITION_MODE: CognitionMode = 'observe';

/* ─────────────── 胜任度与不确定度 ─────────────── */

export interface CompetenceReport {
  readonly signatureKey: string;
  readonly n: number;
  /** 平均残差：越小越准。 */
  readonly meanResidual: number;
  /** 残差标准差：越大越不稳定。 */
  readonly residualStdDev: number;
  /** 校准误差：mean(confidence) − mean(1 − residual)，正值 = 过度自信。 */
  readonly calibrationGap: number;
  readonly from: Timestamp;
  readonly to: Timestamp;
}

export interface Uncertainty {
  readonly signatureKey: string;
  readonly subject: Observable;
  /** 0..1，越高越不确定——由样本量与残差方差共同决定。 */
  readonly entropy: number;
  /** 探测该量的预期成本（token / 秒），用于选最便宜的探针。 */
  readonly probeCost: number;
}

/**
 * A learned strategy (经验 / 已学策略): a scored step sequence with a signature.
 *
 * This is not an installed SKILL.md package. Those stay on `list_skills` /
 * `install_skill`. The `skills` table stores this record; commands must not
 * reuse the SKILL.md names (ARCH-COGNITION §4.5–§4.6).
 */
export interface SkillRecord {
  readonly memoryId: Id;
  readonly steps: readonly string[];
  readonly signatureKey: string;
  readonly attempts: number;
  readonly successes: number;
  /** Mean residual of this strategy under its own signature. */
  readonly meanResidual: number;
  readonly lastAttemptAt: Timestamp;
  /**
   * Heuristic table that produced this row (v8). Absent on Phase 0–3 rows and
   * on databases that have not stored a version yet.
   */
  readonly heuristicTableVersion?: string;
}

/**
 * One row of `situation_stats` (ARCH-COGNITION §7.3).
 *
 * The table's primary key is `(signature_key, subject_kind)`. §7.3 writes
 * `signature_key` alone as PRIMARY KEY, which cannot hold both a verdict row
 * and a tool-outcome row for the same backoff key. The composite key keeps
 * every column from that section and one estimate per observable kind.
 */
export interface SituationStat {
  readonly signatureKey: string;
  readonly subjectKind: ObservableKind;
  readonly n: number;
  readonly sumScore: number;
  readonly sumScoreSq: number;
  readonly sumConfidence: number;
  readonly estimate: PredictionValue;
  readonly updatedAt: Timestamp;
}

/** Response of `explain_prediction`: the row, its residual if scored, and the backoff chain. */
export interface ExplainedPrediction {
  readonly prediction: Prediction;
  readonly residual?: Residual;
  readonly chain: readonly {
    readonly level: number;
    readonly signatureKey: string;
    readonly n: number;
    readonly used: boolean;
  }[];
}

/**
 * Phase 4 advise contracts (ARCH-Camelia-v7 locks + v8 ops).
 *
 * These types are the advise path. They are not the Phase 0–3 prediction
 * `Residual`: that row stays a scored estimate. A structured residual is the
 * verifier comparison the routers and the human gate read.
 * @module
 */

import { ROLLBACK_POINT_TYPES, type HumanGateLevel, type RollbackPointType } from './translate-v1.js';

/** Sealed. A model must not invent a class; unknown strings collapse to `unknown`. */
export const ADVISE_ERROR_CLASSES = [
  'test',
  'type',
  'sandbox',
  'lint',
  'env',
  'contract',
  'tool',
  'model',
  'policy',
  'unknown',
] as const;

export type AdviseErrorClass = (typeof ADVISE_ERROR_CLASSES)[number];

/** Sealed action ids. Router A may only emit these. */
export const ADVISE_ACTION_IDS = [
  'rollback',
  'consult_docs',
  'escalate_human',
  'repair_environment',
  'rerun_verifier',
  'narrow_diff',
] as const;

export type AdviseActionId = (typeof ADVISE_ACTION_IDS)[number];

/** Used when `errorClass` is absent from the heuristic table. Never empty. */
export const UNKNOWN_ACTION_FALLBACK = ['rollback', 'consult_docs', 'escalate_human'] as const satisfies readonly AdviseActionId[];

export type EnvironmentStatus = 'OK' | 'FAIL' | 'UNKNOWN';

/** Alias of `RollbackPointType`. The level enum itself stays on `translate-v1`. */
export type RollbackType = RollbackPointType;

export const HUMAN_GATE_LEVELS = ['L0', 'L1', 'L2', 'L3'] as const satisfies readonly HumanGateLevel[];

export const ROLLBACK_TYPES = ROLLBACK_POINT_TYPES;

/** Consecutive structured mismatches (same verifierId + errorClass) that raise the gate. */
export const STRUCTURED_FAIL_M = 3;

/** Consecutive successes required to lower the gate, or to leave manual mode. */
export const TRUST_SUCCESS_M = 3;

/** Global exploration cap for one UTC day. Not a per-class quota. */
export const DAILY_EXPLORATION_BUDGET = 50;

/** Router B may rank only once the current-version group has this many attempts. */
export const ROUTER_B_MIN_GROUP = 20;

/** Samples written under an older heuristic table count at this weight. */
export const OLD_HEURISTIC_WEIGHT = 0.5;

export const TRANSLATE_SCHEMA_VERSION = '1.0';

/** Hot environment logs. Older entries are counted, not kept. */
export const HOT_LOG_MS = 7 * 24 * 60 * 60 * 1000;

export interface CriticalDiff {
  readonly equal: boolean;
  /** Dotted paths whose critical values differ. */
  readonly changed: readonly string[];
  /** Dotted paths ignored as timestamp or random-id noise. */
  readonly ignored: readonly string[];
}

export interface StructuredResidual {
  readonly verifierId: string;
  readonly errorClass: AdviseErrorClass;
  readonly expected: Readonly<Record<string, unknown>>;
  readonly actual: Readonly<Record<string, unknown>>;
  readonly diff: CriticalDiff;
  readonly environment: EnvironmentStatus;
  /** Hard gates: test, type, sandbox. Anything else is null. */
  readonly hardGate: 'test' | 'type' | 'sandbox' | null;
  /** Soft gate: lint only. */
  readonly softGate: 'lint' | null;
  readonly at: number;
}

export interface TranslatedAction {
  readonly action_id: AdviseActionId;
  readonly prediction: string;
  readonly confidence: number;
  readonly verifier_target: string;
  readonly rollback_point: { readonly type: RollbackType; readonly id: string };
  readonly human_gate_level: HumanGateLevel;
}

export type AdviceDisposition = 'rejected' | 'pending_human' | 'authorized';

export type RouterASource = 'table' | 'unknown-fallback' | 'environment-fail' | 'environment-unknown-batch';

export interface AdviceTicket {
  readonly id: string;
  readonly disposition: AdviceDisposition;
  readonly rejectReason?: string;
  readonly errorClass: AdviseErrorClass;
  readonly verifierId: string;
  readonly environment: EnvironmentStatus;
  readonly environmentDegraded: boolean;
  readonly batchedUnknown: boolean;
  readonly environmentAttempts: number;
  readonly candidates: readonly AdviseActionId[];
  readonly routerSource: RouterASource;
  readonly heuristicTableVersion: string;
  readonly ranked: boolean;
  readonly rankOrder: readonly AdviseActionId[];
  readonly conflict: boolean;
  readonly explored: boolean;
  readonly actionId?: AdviseActionId;
  readonly translated?: TranslatedAction;
  readonly gate: HumanGateLevel;
  readonly gateMode: 'auto' | 'manual';
  readonly diffEqual: boolean;
  readonly skillWritten: boolean;
}

export interface AdviseMetricsSnapshot {
  /** Default-visible system health. */
  readonly health: {
    /** Null until a human gate has been presented. */
    readonly gatePassRate: number | null;
    /** Unequal critical diffs, keyed by errorClass. */
    readonly residualDistribution: Readonly<Record<string, number>>;
    readonly gateRaisesAuto: number;
    readonly gateRaisesManual: number;
  };
  /** Collapsed diagnostics. */
  readonly diagnostic: {
    readonly routerHitsA: number;
    readonly routerHitsB: number;
    /** Null until translate has been attempted. */
    readonly translateRejectRate: number | null;
    readonly skillRecordsToday: number;
  };
  readonly trust: {
    readonly level: HumanGateLevel;
    readonly mode: 'auto' | 'manual';
    readonly successStreak: number;
  };
}

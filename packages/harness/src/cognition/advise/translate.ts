/**
 * translate() — Schema v1.0, stateless, capped context (ARCH-Camelia-v7 §2.4, §3.1).
 *
 * The context may contain only errorClass, verifierId, action_id, a 3–5 value
 * signature summary, and the latest success or failure. Extra fields reject.
 * The function fills the frozen schema from that context. It does not chat
 * and it does not invent an action id.
 * @module
 */

import {
  ADVISE_ACTION_IDS,
  ADVISE_ERROR_CLASSES,
  HUMAN_GATE_LEVELS,
  ROLLBACK_TYPES,
  type AdviseActionId,
  type AdviseErrorClass,
  type HumanGateLevel,
  type RollbackType,
  type TranslatedAction,
} from '@camelia/core';

export interface TranslateContext {
  readonly errorClass: AdviseErrorClass;
  readonly verifierId: string;
  readonly action_id: AdviseActionId;
  readonly signature: readonly string[];
  readonly lastOutcome: 'success' | 'failure';
}

export type TranslateResult = { ok: true; value: TranslatedAction } | { ok: false; reason: string };

const CONTEXT_KEYS = new Set(['errorClass', 'verifierId', 'action_id', 'signature', 'lastOutcome']);
const SCHEMA_KEYS = new Set(['action_id', 'prediction', 'confidence', 'verifier_target', 'rollback_point', 'human_gate_level']);
const ROLLBACK_KEYS = new Set(['type', 'id']);

export function translate(input: {
  context: TranslateContext;
  confidence: number;
  rollback: { type: RollbackType; id: string };
  humanGateLevel: HumanGateLevel;
}): TranslateResult {
  const contextError = validateContext(input.context);
  if (contextError) return { ok: false, reason: contextError };
  if (!inUnit(input.confidence)) return { ok: false, reason: 'confidence' };
  if (!ROLLBACK_TYPES.includes(input.rollback.type)) return { ok: false, reason: 'rollback.type' };
  if (!nonEmpty(input.rollback.id)) return { ok: false, reason: 'rollback.id' };
  if (!HUMAN_GATE_LEVELS.includes(input.humanGateLevel)) return { ok: false, reason: 'human_gate_level' };

  const value: TranslatedAction = {
    action_id: input.context.action_id,
    prediction: `${input.context.errorClass}→${input.context.action_id}`.slice(0, 200),
    confidence: input.confidence,
    verifier_target: input.context.verifierId,
    rollback_point: { type: input.rollback.type, id: input.rollback.id },
    human_gate_level: input.humanGateLevel,
  };
  return validateTranslated(value);
}

/** Reject a value that is not exactly Schema v1.0. */
export function validateTranslated(value: unknown): TranslateResult {
  if (!isRecord(value)) return { ok: false, reason: 'schema' };
  if (!exactKeys(value, SCHEMA_KEYS)) return { ok: false, reason: 'schema' };
  if (typeof value.action_id !== 'string' || !ADVISE_ACTION_IDS.includes(value.action_id as AdviseActionId)) {
    return { ok: false, reason: 'action_id' };
  }
  if (typeof value.prediction !== 'string' || !value.prediction.trim()) return { ok: false, reason: 'prediction' };
  if (!inUnit(value.confidence)) return { ok: false, reason: 'confidence' };
  if (typeof value.verifier_target !== 'string' || !value.verifier_target.trim()) return { ok: false, reason: 'verifier_target' };
  if (!isRecord(value.rollback_point) || !exactKeys(value.rollback_point, ROLLBACK_KEYS)) return { ok: false, reason: 'rollback_point' };
  if (typeof value.rollback_point.type !== 'string' || !ROLLBACK_TYPES.includes(value.rollback_point.type as RollbackType)) {
    return { ok: false, reason: 'rollback.type' };
  }
  if (!nonEmpty(value.rollback_point.id)) return { ok: false, reason: 'rollback.id' };
  if (typeof value.human_gate_level !== 'string' || !HUMAN_GATE_LEVELS.includes(value.human_gate_level as HumanGateLevel)) {
    return { ok: false, reason: 'human_gate_level' };
  }
  return {
    ok: true,
    value: {
      action_id: value.action_id as AdviseActionId,
      prediction: value.prediction,
      confidence: value.confidence as number,
      verifier_target: value.verifier_target,
      rollback_point: { type: value.rollback_point.type as RollbackType, id: String(value.rollback_point.id) },
      human_gate_level: value.human_gate_level as HumanGateLevel,
    },
  };
}

export function validateContext(context: object): string | undefined {
  if (!exactKeys(context as Record<string, unknown>, CONTEXT_KEYS)) return 'context.extra';
  const row = context as Record<string, unknown>;
  if (typeof row.errorClass !== 'string' || !ADVISE_ERROR_CLASSES.includes(row.errorClass as AdviseErrorClass)) return 'context.errorClass';
  if (!nonEmpty(row.verifierId)) return 'context.verifier';
  if (typeof row.action_id !== 'string' || !ADVISE_ACTION_IDS.includes(row.action_id as AdviseActionId)) return 'context.action';
  if (!Array.isArray(row.signature) || row.signature.length < 3 || row.signature.length > 5) return 'context.signature';
  if (!row.signature.every((item) => typeof item === 'string' && item.trim().length > 0 && item.length <= 64 && !item.includes('\n'))) {
    return 'context.signature';
  }
  if (row.lastOutcome !== 'success' && row.lastOutcome !== 'failure') return 'context.lastOutcome';
  return undefined;
}

function inUnit(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function exactKeys(value: Record<string, unknown>, allowed: Set<string>): boolean {
  const keys = Object.keys(value);
  return keys.length === allowed.size && keys.every((key) => allowed.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

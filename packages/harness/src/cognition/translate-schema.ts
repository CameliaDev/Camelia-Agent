/**
 * translate() Schema v1.0 validator (ARCH-Camelia-v7 §3.1) — stateless, no model.
 * @module
 */

import {
  ROLLBACK_POINT_TYPES,
  type HumanGateLevel,
  type TranslateActionV1,
  type TranslateParseResult,
  parseRollbackPoint,
} from '@camelia/core';

import { validateRollbackPoint, type RollbackProbePorts } from '../recovery/rollback-point.js';

const HUMAN_GATE_LEVELS: readonly HumanGateLevel[] = ['L0', 'L1', 'L2', 'L3'];

function reject(code: Extract<TranslateParseResult, { ok: false }>['code'], detail: string, field?: string): TranslateParseResult {
  return { ok: false, code, detail, field };
}

/**
 * Parse and validate a translate JSON payload. Illegal → Reject (no SkillRecord write).
 */
export function parseTranslateActionV1(
  raw: unknown,
  rollbackProbes?: RollbackProbePorts,
): TranslateParseResult {
  if (!raw || typeof raw !== 'object') {
    return reject('missing_field', 'payload must be an object');
  }
  const o = raw as Record<string, unknown>;

  const action_id = o.action_id;
  if (typeof action_id !== 'string' || !action_id.trim()) {
    return reject('missing_field', 'action_id required', 'action_id');
  }
  const prediction = o.prediction;
  if (typeof prediction !== 'string') {
    return reject('invalid_type', 'prediction must be string', 'prediction');
  }
  const confidence = o.confidence;
  if (typeof confidence !== 'number' || Number.isNaN(confidence)) {
    return reject('invalid_type', 'confidence must be number', 'confidence');
  }
  if (confidence < 0 || confidence > 1) {
    return reject('confidence_out_of_range', 'confidence must be in [0,1]', 'confidence');
  }
  const verifier_target = o.verifier_target;
  if (typeof verifier_target !== 'string' || !verifier_target.trim()) {
    return reject('missing_field', 'verifier_target required', 'verifier_target');
  }
  const human_gate_level = o.human_gate_level;
  if (typeof human_gate_level !== 'string' || !HUMAN_GATE_LEVELS.includes(human_gate_level as HumanGateLevel)) {
    return reject('enum_out_of_range', 'human_gate_level must be L0|L1|L2|L3', 'human_gate_level');
  }

  const rollback_point = parseRollbackPoint({ type: (o.rollback_point as { type?: unknown })?.type, id: (o.rollback_point as { id?: unknown })?.id });
  if (!rollback_point) {
    const allowed = ROLLBACK_POINT_TYPES.join('|');
    return reject('rollback_invalid', `rollback_point.type must be ${allowed} with non-empty id`, 'rollback_point');
  }

  const rollbackCheck = validateRollbackPoint(rollback_point, rollbackProbes);
  if (!rollbackCheck.ok) {
    return reject('rollback_invalid', rollbackCheck.detail ?? 'rollback precheck failed', 'rollback_point');
  }

  const action: TranslateActionV1 = {
    action_id: action_id.trim(),
    prediction,
    confidence,
    verifier_target: verifier_target.trim(),
    rollback_point,
    human_gate_level: human_gate_level as HumanGateLevel,
  };
  return { ok: true, action };
}

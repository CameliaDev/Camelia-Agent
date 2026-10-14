/**
 * translate() JSON Schema v1.0 — frozen in ARCH-Camelia-v7 §3.1.
 *
 * Invalid payloads must be rejected before execution or SkillRecord writes.
 * @module
 */

import type { Id } from './common.js';

/** Machine-readable rollback kinds validated before execution (v7 §3.3). */
export const ROLLBACK_POINT_TYPES = [
  'git_stash',
  'file_backup',
  'docker_snapshot',
  'db_transaction',
] as const;

export type RollbackPointType = (typeof ROLLBACK_POINT_TYPES)[number];

export interface RollbackPoint {
  readonly type: RollbackPointType;
  readonly id: string;
}

export type HumanGateLevel = 'L0' | 'L1' | 'L2' | 'L3';

/** Subset of translate v1.0 used for rollback validation and Phase 4 wiring. */
export interface TranslateActionV1 {
  readonly action_id: string;
  readonly prediction: string;
  readonly confidence: number;
  readonly verifier_target: string;
  readonly rollback_point: RollbackPoint;
  readonly human_gate_level: HumanGateLevel;
}

export function isRollbackPointType(value: unknown): value is RollbackPointType {
  return typeof value === 'string' && (ROLLBACK_POINT_TYPES as readonly string[]).includes(value);
}

export function parseRollbackPoint(raw: unknown): RollbackPoint | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const type = (raw as { type?: unknown }).type;
  const id = (raw as { id?: unknown }).id;
  if (!isRollbackPointType(type) || typeof id !== 'string' || id.trim() === '') return undefined;
  return { type, id: id.trim() };
}

/** Structural check for rollback_point inside a translate payload. */
export function rollbackPointFromTranslate(raw: unknown): RollbackPoint | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  return parseRollbackPoint((raw as { rollback_point?: unknown }).rollback_point);
}

export type TranslateRejectCode =
  | 'missing_field'
  | 'invalid_type'
  | 'enum_out_of_range'
  | 'confidence_out_of_range'
  | 'rollback_invalid';

export interface TranslateReject {
  readonly ok: false;
  readonly code: TranslateRejectCode;
  readonly field?: string;
  readonly detail: string;
}

export interface TranslateAccept {
  readonly ok: true;
  readonly action: TranslateActionV1;
}

export type TranslateParseResult = TranslateAccept | TranslateReject;

export function isRollbackPointId(id: string): boolean {
  return id.trim().length > 0 && id.length <= 512;
}

/** Placeholder for SkillRecord linkage — v8 writes heuristic_table_version alongside skills. */
export interface SkillRecordRollbackMeta {
  readonly rollbackPoint?: RollbackPoint;
  readonly heuristicTableVersion?: string;
  readonly memoryId?: Id;
}

/**
 * Rollback point validators (ARCH-Camelia-v7 §3.3) — pure, read-only stubs.
 *
 * Execution hooks (git stash list, docker API, etc.) are injected so tests stay
 * deterministic. Failure → reject the translate action, do not execute.
 * @module
 */

import {
  type RollbackPoint,
  type RollbackPointType,
  isRollbackPointId,
  parseRollbackPoint,
} from '@camelia/core';

export type RollbackValidationCode =
  | 'invalid_shape'
  | 'missing_stash'
  | 'missing_file'
  | 'missing_snapshot'
  | 'missing_transaction';

export interface RollbackValidationResult {
  readonly ok: boolean;
  readonly type?: RollbackPointType;
  readonly id?: string;
  readonly code?: RollbackValidationCode;
  readonly detail?: string;
}

/** Read-only probes used before rollback execution. */
export interface RollbackProbePorts {
  /** Returns true when `git stash list` would include the id. */
  gitStashExists?(id: string): boolean;
  /** Returns true when the backup file exists and is readable. */
  fileBackupReadable?(path: string): boolean;
  /** Returns true when the docker snapshot id is known. */
  dockerSnapshotExists?(id: string): boolean;
  /** Returns true when a DB transaction with this id is open. */
  dbTransactionOpen?(id: string): boolean;
}

const defaultProbes: RollbackProbePorts = {};

/**
 * Validate rollback_point shape from a translate payload fragment.
 * Does not execute rollback — only checks machine-readable preconditions.
 */
export function validateRollbackPoint(
  raw: unknown,
  probes: RollbackProbePorts = defaultProbes,
): RollbackValidationResult {
  const point = parseRollbackPoint(raw);
  if (!point) {
    return { ok: false, code: 'invalid_shape', detail: 'rollback_point.type|id invalid' };
  }
  if (!isRollbackPointId(point.id)) {
    return { ok: false, code: 'invalid_shape', detail: 'rollback_point.id empty or too long' };
  }
  return validateRollbackPointResolved(point, probes);
}

export function validateRollbackPointResolved(
  point: RollbackPoint,
  probes: RollbackProbePorts = defaultProbes,
): RollbackValidationResult {
  switch (point.type) {
    case 'git_stash': {
      const exists = probes.gitStashExists?.(point.id);
      if (exists === false) {
        return {
          ok: false,
          type: point.type,
          id: point.id,
          code: 'missing_stash',
          detail: `git stash ${point.id} not found`,
        };
      }
      break;
    }
    case 'file_backup': {
      const readable = probes.fileBackupReadable?.(point.id);
      if (readable === false) {
        return {
          ok: false,
          type: point.type,
          id: point.id,
          code: 'missing_file',
          detail: `backup file not readable: ${point.id}`,
        };
      }
      break;
    }
    case 'docker_snapshot': {
      const exists = probes.dockerSnapshotExists?.(point.id);
      if (exists === false) {
        return {
          ok: false,
          type: point.type,
          id: point.id,
          code: 'missing_snapshot',
          detail: `docker snapshot ${point.id} not found`,
        };
      }
      break;
    }
    case 'db_transaction': {
      const open = probes.dbTransactionOpen?.(point.id);
      if (open === false) {
        return {
          ok: false,
          type: point.type,
          id: point.id,
          code: 'missing_transaction',
          detail: `db transaction ${point.id} not open`,
        };
      }
      break;
    }
  }
  return { ok: true, type: point.type, id: point.id };
}

/** Stub executor — records intent only until Phase 4 wires real rollback. */
export async function executeRollbackPoint(
  point: RollbackPoint,
  probes: RollbackProbePorts = defaultProbes,
): Promise<RollbackValidationResult> {
  const check = validateRollbackPointResolved(point, probes);
  if (!check.ok) return check;
  return { ok: true, type: point.type, id: point.id, detail: 'rollback stub — not executed' };
}

/**
 * Rollback-point checks. Pure and read-only: the caller supplies evidence
 * gathered elsewhere. A miss rejects the order and must not execute it.
 *
 * The shape and kind checks go through `validateRollbackPoint`. Probes are
 * always explicit booleans, so a missing id fails closed. Omitting a probe
 * would let the stage-22 stub treat the point as present.
 * @module
 */

import { ROLLBACK_TYPES, type RollbackType } from '@camelia/core';

import { validateRollbackPoint, type RollbackProbePorts } from '../../recovery/rollback-point.js';

export interface RollbackEvidence {
  readonly gitStashes: readonly string[];
  readonly readableFiles: readonly string[];
  readonly dockerSnapshots: readonly string[];
  readonly openTransactions: readonly string[];
}

export type RollbackCheck = { ok: true } | { ok: false; reason: string };

export function validateRollback(point: { type: string; id: string }, evidence: RollbackEvidence): RollbackCheck {
  if (!ROLLBACK_TYPES.includes(point.type as RollbackType)) return { ok: false, reason: 'rollback.type' };
  if (!point.id.trim()) return { ok: false, reason: 'rollback.id' };
  const checked = validateRollbackPoint(point, probesFromEvidence(evidence));
  if (!checked.ok) return { ok: false, reason: `rollback.missing.${point.type}` };
  return { ok: true };
}

function probesFromEvidence(evidence: RollbackEvidence): RollbackProbePorts {
  return {
    gitStashExists: (id) => evidence.gitStashes.includes(id),
    fileBackupReadable: (id) => evidence.readableFiles.includes(id),
    dockerSnapshotExists: (id) => evidence.dockerSnapshots.includes(id),
    dbTransactionOpen: (id) => evidence.openTransactions.includes(id),
  };
}

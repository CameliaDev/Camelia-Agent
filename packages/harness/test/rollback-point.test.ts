import { describe, expect, it } from 'vitest';

import { parseTranslateActionV1 } from '../src/cognition/translate-schema.js';
import { mayWriteMemoryFromVerifier } from '../src/cognition/memory-write-gate.js';
import { validateRollbackPoint, validateRollbackPointResolved } from '../src/recovery/rollback-point.js';

describe('validateRollbackPoint', () => {
  it('accepts valid shape when probes are absent (stub pass)', () => {
    const result = validateRollbackPoint({ type: 'git_stash', id: 'stash@{0}' });
    expect(result.ok).toBe(true);
  });

  it('rejects unknown rollback type', () => {
    const result = validateRollbackPoint({ type: 'zip_backup', id: 'x' });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('invalid_shape');
  });

  it('fails when git stash probe reports missing', () => {
    const result = validateRollbackPointResolved(
      { type: 'git_stash', id: 'missing' },
      { gitStashExists: () => false },
    );
    expect(result.ok).toBe(false);
    expect(result.code).toBe('missing_stash');
  });

  it('covers all four v7 rollback enums', () => {
    const probes = {
      gitStashExists: () => true,
      fileBackupReadable: () => true,
      dockerSnapshotExists: () => true,
      dbTransactionOpen: () => true,
    };
    for (const type of ['git_stash', 'file_backup', 'docker_snapshot', 'db_transaction'] as const) {
      expect(validateRollbackPointResolved({ type, id: 'id-1' }, probes).ok).toBe(true);
    }
  });
});

describe('parseTranslateActionV1', () => {
  const valid = {
    action_id: 'act-1',
    prediction: 'retry with patch',
    confidence: 0.8,
    verifier_target: 'hard:compile',
    rollback_point: { type: 'file_backup', id: '/tmp/backup.tar' },
    human_gate_level: 'L1',
  };

  it('accepts a valid v1 payload', () => {
    const parsed = parseTranslateActionV1(valid, { fileBackupReadable: () => true });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.action.rollback_point.type).toBe('file_backup');
  });

  it('rejects confidence out of range', () => {
    const parsed = parseTranslateActionV1({ ...valid, confidence: 1.2 });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.code).toBe('confidence_out_of_range');
  });

  it('rejects rollback when probe fails', () => {
    const parsed = parseTranslateActionV1(valid, { fileBackupReadable: () => false });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.code).toBe('rollback_invalid');
  });
});

describe('mayWriteMemoryFromVerifier', () => {
  it('blocks when hard gate failed', () => {
    expect(mayWriteMemoryFromVerifier({ hardGatePassed: false }).allow).toBe(false);
  });

  it('allows when hard gate passed', () => {
    expect(mayWriteMemoryFromVerifier({ hardGatePassed: true }).allow).toBe(true);
  });
});

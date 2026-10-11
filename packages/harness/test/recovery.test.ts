/**
 * Error classification and the recovery ladder — the deterministic core of
 * whitepaper §3.11. No model, no randomness: every decision here is reproducible.
 * @module
 */

import { describe, expect, it, vi } from 'vitest';

import { ModelCallError } from '../src/model/ModelGateway.js';
import { backoff, ErrorRecovery, withTransientRetry } from '../src/recovery/ErrorRecovery.js';

describe('ErrorRecovery.classify', () => {
  const recovery = new ErrorRecovery(3);

  it('classifies a transient network failure', () => {
    expect(recovery.classify(new Error('connect ETIMEDOUT 1.2.3.4:443'))).toBe('transient');
    expect(recovery.classify(new Error('429 Too Many Requests'))).toBe('transient');
  });

  it('classifies a policy denial', () => {
    expect(recovery.classify(new Error('DENIED (policy): path ".git/" is on the deny list'))).toBe('policy');
    expect(recovery.classify(new Error('action requires approval'))).toBe('policy');
  });

  it('classifies a tool-level failure', () => {
    expect(recovery.classify(new Error('ENOENT: no such file or directory'))).toBe('tool');
    expect(recovery.classify(new Error('oldText not found in src/a.ts'))).toBe('tool');
    expect(recovery.classify(new Error('command failed with exit code 1'))).toBe('tool');
  });

  it('falls back to permanent for anything unrecognised', () => {
    expect(recovery.classify(new Error('assertion failed: expected 1 to equal 2'))).toBe('permanent');
  });

  it('classifies a retryable ModelCallError as transient', () => {
    const error = new ModelCallError('503 temporarily unavailable', 'execute', 3, true);
    expect(recovery.classify(error)).toBe('transient');
  });

  it('classifies a non-retryable ModelCallError as a model error', () => {
    const error = new ModelCallError('malformed JSON in plan', 'plan', 1, false);
    expect(recovery.classify(error)).toBe('model');
  });
});

describe('ErrorRecovery.strategy', () => {
  const recovery = new ErrorRecovery(3);

  it('retries transient failures with backoff, then switches provider', () => {
    expect(recovery.strategy('transient', 1).kind).toBe('retry');
    expect(recovery.strategy('transient', 1).backoffMs).toBeGreaterThan(0);
    expect(recovery.strategy('transient', 3).kind).toBe('switch-provider');
  });

  it('rolls back an unrecoverable tool failure', () => {
    expect(recovery.strategy('tool', 1).kind).toBe('retry');
    expect(recovery.strategy('tool', 3).kind).toBe('rollback');
  });

  it('asks a human for a policy block, then aborts', () => {
    expect(recovery.strategy('policy', 1).kind).toBe('ask-human');
    expect(recovery.strategy('policy', 2).kind).toBe('abort');
  });

  it('rolls back then replans a permanent failure', () => {
    expect(recovery.strategy('permanent', 1).kind).toBe('rollback');
    expect(recovery.strategy('permanent', 2).kind).toBe('replan');
  });

  it('produces a bounded, terminating ladder', () => {
    const ladder = recovery.ladder('transient');
    expect(ladder).toHaveLength(4);
    expect(ladder[ladder.length - 1]!.kind).toBe('switch-provider');
  });
});

describe('backoff', () => {
  it('grows exponentially and caps out', () => {
    expect(backoff(1)).toBe(400);
    expect(backoff(2)).toBe(800);
    expect(backoff(10)).toBe(8_000);
  });
});

describe('withTransientRetry', () => {
  it('returns on the first success', async () => {
    const recovery = new ErrorRecovery(3);
    const operation = vi.fn(async () => 'ok');
    const result = await withTransientRetry(operation, recovery, { maxRetries: 3, sleep: async () => {} });
    expect(result.ok).toBe(true);
    expect(result.value).toBe('ok');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('retries a transient failure and then succeeds', async () => {
    const recovery = new ErrorRecovery(3);
    let calls = 0;
    const operation = async (): Promise<string> => {
      calls += 1;
      if (calls < 3) throw new Error('ECONNRESET');
      return 'recovered';
    };
    const result = await withTransientRetry(operation, recovery, { maxRetries: 3, sleep: async () => {} });
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(3);
  });

  it('does not retry a non-transient failure', async () => {
    const recovery = new ErrorRecovery(3);
    const operation = vi.fn(async () => {
      throw new Error('oldText not found');
    });
    const result = await withTransientRetry(operation, recovery, { maxRetries: 3, sleep: async () => {} });
    expect(result.ok).toBe(false);
    expect(result.lastClass).toBe('tool');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('gives up after maxRetries and reports the last class', async () => {
    const recovery = new ErrorRecovery(2);
    const operation = vi.fn(async () => {
      throw new Error('ETIMEDOUT');
    });
    const result = await withTransientRetry(operation, recovery, { maxRetries: 2, sleep: async () => {} });
    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(2);
    expect(result.lastClass).toBe('transient');
  });

  it('invokes onRetry with the chosen strategy', async () => {
    const recovery = new ErrorRecovery(3);
    const onRetry = vi.fn();
    let calls = 0;
    await withTransientRetry(
      async () => {
        calls += 1;
        if (calls === 1) throw new Error('503');
        return 'ok';
      },
      recovery,
      { maxRetries: 3, sleep: async () => {}, onRetry },
    );
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
/**
 * Reliability mechanisms — the four ways a task goes wrong and the deterministic
 * checks that catch each one before it becomes a failed task (whitepaper §4).
 * @module
 */

import { describe, expect, it } from 'vitest';

import type { Evidence } from '@camelia/core';
import { DriftDetector } from '../src/reliability/DriftDetector.js';
import { HallucinationGuard } from '../src/reliability/HallucinationGuard.js';
import { LoopDetector, stableStringify } from '../src/reliability/LoopDetector.js';

describe('DriftDetector', () => {
  const detector = new DriftDetector(0.45);

  it('does not flag an on-goal step', () => {
    const result = detector.assess({
      goal: 'add a CONTRIBUTING.md file with a code of conduct',
      currentOutput: 'created CONTRIBUTING.md with a code of conduct section',
      expectedPaths: ['CONTRIBUTING.md'],
      touchedPaths: ['CONTRIBUTING.md'],
      noProgressStreak: 0,
    });
    expect(result.drifted).toBe(false);
    expect(result.score).toBeLessThan(0.45);
  });

  it('flags an off-goal step with diverging files and no progress', () => {
    const result = detector.assess({
      goal: 'add a CONTRIBUTING.md file with a code of conduct',
      currentOutput: 'refactored the database connection pool and tuned indexes',
      expectedPaths: ['CONTRIBUTING.md'],
      touchedPaths: ['src/db/pool.ts', 'src/db/indexes.ts'],
      noProgressStreak: 3,
    });
    expect(result.drifted).toBe(true);
    expect(result.signals.length).toBeGreaterThan(0);
    expect(result.components.files).toBeGreaterThan(0.7);
  });

  it('ignores file divergence when the plan declared no paths', () => {
    const result = detector.assess({
      goal: 'explain how the auth flow works',
      currentOutput: 'the auth flow starts in middleware and ends in the session store',
      expectedPaths: [],
      touchedPaths: [],
      noProgressStreak: 0,
    });
    expect(result.components.files).toBe(0);
    expect(result.drifted).toBe(false);
  });

  it('reports a no-progress streak as a signal', () => {
    const result = detector.assess({
      goal: 'x',
      currentOutput: 'x',
      expectedPaths: [],
      touchedPaths: [],
      noProgressStreak: 2,
    });
    expect(result.signals.some((s) => s.includes('consecutive steps'))).toBe(true);
  });
});

describe('stableStringify', () => {
  it('is insensitive to key order', () => {
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }));
  });

  it('handles nested arrays and nulls deterministically', () => {
    expect(stableStringify({ x: [1, { y: null }] })).toBe('{"x":[1,{"y":null}]}');
  });
});

describe('LoopDetector', () => {
  it('does not fire below the repeat threshold', () => {
    const loop = new LoopDetector(3);
    expect(loop.recordAction('fs.read', { path: 'a' }).detected).toBe(false);
    expect(loop.recordAction('fs.read', { path: 'a' }).detected).toBe(false);
    expect(loop.trailingRepeats).toBe(2);
  });

  it('fires when the identical call repeats to the threshold', () => {
    const loop = new LoopDetector(3);
    loop.recordAction('fs.read', { path: 'a' });
    loop.recordAction('fs.read', { path: 'a' });
    const signal = loop.recordAction('fs.read', { path: 'a' });
    expect(signal.detected).toBe(true);
    expect(signal.kind).toBe('action');
    expect(signal.repeats).toBe(3);
  });

  it('treats differently-ordered arguments as the same action', () => {
    const loop = new LoopDetector(2);
    loop.recordAction('fs.edit', { path: 'a', oldText: 'x' });
    const signal = loop.recordAction('fs.edit', { oldText: 'x', path: 'a' });
    expect(signal.detected).toBe(true);
  });

  it('does not fire for genuinely different arguments', () => {
    const loop = new LoopDetector(2);
    loop.recordAction('fs.read', { path: 'a' });
    expect(loop.recordAction('fs.read', { path: 'b' }).detected).toBe(false);
  });

  it('detects a repeated task state', () => {
    const loop = new LoopDetector(3);
    expect(loop.recordState('digest-1').detected).toBe(false);
    const signal = loop.recordState('digest-1');
    expect(signal.detected).toBe(true);
    expect(signal.kind).toBe('state');
  });

  it('resets all history', () => {
    const loop = new LoopDetector(2);
    loop.recordAction('fs.read', { path: 'a' });
    loop.recordState('d');
    loop.reset();
    expect(loop.actionCount).toBe(0);
    expect(loop.recordState('d').detected).toBe(false);
  });
});

describe('HallucinationGuard', () => {
  const guard = new HallucinationGuard();
  const toolEvidence: Evidence[] = [{ kind: 'tool-call', ref: 'call-1', detail: 'fs.write' }];

  it('blocks a completion claim with no tool evidence', () => {
    const verdict = guard.checkClaim('I have created the file and all tests pass.', []);
    expect(verdict.blocked).toBe(true);
    expect(verdict.claim).toContain('created the file');
  });

  it('allows a completion claim backed by a tool call', () => {
    expect(guard.checkClaim('Done — the file was created.', toolEvidence).blocked).toBe(false);
  });

  it('treats command output as evidence', () => {
    const evidence: Evidence[] = [{ kind: 'command-output', ref: 'npm test' }];
    expect(guard.checkClaim('All tests pass.', evidence).blocked).toBe(false);
  });

  it('does not block a non-completion statement', () => {
    expect(guard.checkClaim('I will now read the configuration file.', []).blocked).toBe(false);
  });

  it('recognises Chinese completion claims', () => {
    expect(guard.isCompletionClaim('文件已创建完成。')).toBe(true);
  });

  it('detects an existence claim as a completion claim', () => {
    expect(guard.isCompletionClaim('The file src/index.ts was created.')).toBe(true);
  });
});
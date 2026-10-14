/**
 * Phase 2 estimator. Pure: no IO, no model, no randomness.
 * @module
 */

import { describe, expect, it } from 'vitest';

import type { Plan, Prediction, PredictionContext, Residual, Step } from '@camelia/core';

import { BackoffTable } from '../src/cognition/BackoffTable.js';
import { ObserveOnlyPolicy } from '../src/cognition/CognitivePolicy.js';
import { coldStartPrior } from '../src/cognition/prior.js';
import {
  binaryBrier,
  categoricalBrier,
  decideSurprise,
  jaccardDistance,
  nrmse,
} from '../src/cognition/score.js';
import {
  buildSignature,
  inferArchetype,
  signatureKeyAt,
} from '../src/cognition/signature.js';
import { defaultHarnessConfig } from '../src/config.js';

const edit = {
  capability: 'tool-calling' as const,
  archetype: 'edit' as const,
  scope: 'few-files' as const,
  toolset: ['fs.edit'],
  inDegree: 2,
};

describe('score', () => {
  it('punishes overconfident binary misses more than uncertain ones', () => {
    const confident = binaryBrier(0.95, false);
    const uncertain = binaryBrier(0.5, false);
    expect(confident).toBeCloseTo(0.9025, 6);
    expect(uncertain).toBeCloseTo(0.25, 6);
    expect(confident).toBeGreaterThan(uncertain);
    expect(categoricalBrier({ ok: 0.95, error: 0.05 }, 'error')).toBeCloseTo(0.9025, 6);
    expect(categoricalBrier({ ok: 0.5, error: 0.5 }, 'error')).toBeCloseTo(0.25, 6);
  });

  it('normalises absolute error by max(1, |observed|)', () => {
    expect(nrmse(3, 4)).toBeCloseTo(0.25, 6);
    expect(nrmse(300, 400)).toBeCloseTo(0.25, 6);
    expect(nrmse(0, 0)).toBe(0);
    expect(nrmse(5, 0)).toBe(1);
    expect(nrmse(100, 1)).toBe(1);
  });

  it('treats two empty sets as a perfect Jaccard prediction', () => {
    expect(jaccardDistance([], [])).toBe(0);
    expect(jaccardDistance(['src/a.ts'], ['src/a.ts'])).toBe(0);
    expect(jaccardDistance(['src/a.ts'], [])).toBe(1);
    expect(jaccardDistance(['src/a.ts', 'src/b.ts'], ['src/b.ts', 'src/c.ts'])).toBeCloseTo(2 / 3, 6);
  });

  it('never marks a prior or an under-sampled residual as a surprise', () => {
    expect(
      decideSurprise({ score: 0.99, source: 'prior', sampleCount: 40, recentScores: [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1] }).surprise,
    ).toBe(false);
    expect(
      decideSurprise({
        score: 0.99,
        source: 'empirical-backoff',
        sampleCount: 7,
        recentScores: [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1],
      }).surprise,
    ).toBe(false);
    const quiet = [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1];
    const loud = decideSurprise({ score: 0.9, source: 'empirical-backoff', sampleCount: 8, recentScores: quiet });
    expect(loud.surprise).toBe(true);
    expect(loud.threshold).not.toBeNull();
    const calm = decideSurprise({ score: 0.05, source: 'empirical-backoff', sampleCount: 8, recentScores: quiet });
    expect(calm.surprise).toBe(false);
  });
});

describe('backoff', () => {
  it('walks from L3 to the prior and stops at the first level with minLevelSamples', () => {
    const table = new BackoffTable({ minLevelSamples: 3 });
    const prior = { kind: 'categorical-multi' as const, probs: { pass: 0.5, fail: 0.5 } };
    expect(table.lookup(edit, 'verdict', prior, 'prior: test').source).toBe('prior');
    expect(table.lookup(edit, 'verdict', prior, 'prior: test').level).toBe(-1);

    table.absorb(edit, 'verdict', { kind: 'categorical', label: 'fail' });
    table.absorb(edit, 'verdict', { kind: 'categorical', label: 'fail' });
    expect(table.lookup(edit, 'verdict', prior, 'prior: test').source).toBe('prior');

    table.absorb(edit, 'verdict', { kind: 'categorical', label: 'fail' });
    const specific = table.lookup(edit, 'verdict', prior, 'prior: test');
    expect(specific.source).toBe('empirical-backoff');
    expect(specific.level).toBe(3);
    expect(specific.signatureKey).toBe('tool-calling|edit|few-files|2');
    expect(specific.n).toBe(3);

    const rarer = table.lookup({ ...edit, inDegree: 9 }, 'verdict', prior, 'prior: test');
    expect(rarer.level).toBe(2);
    expect(rarer.signatureKey).toBe('tool-calling|edit|few-files|*');
    expect(rarer.n).toBe(3);
  });
});

describe('signature', () => {
  it('serialises the documented backoff keys', () => {
    const signature = {
      capability: 'text-tool-calls' as const,
      archetype: 'edit' as const,
      scope: 'few-files' as const,
      toolset: ['fs.edit'],
      inDegree: 3,
    };
    expect(signatureKeyAt(signature, 3)).toBe('text-tool-calls|edit|few-files|3');
    expect(signatureKeyAt(signature, 2)).toBe('text-tool-calls|edit|few-files|*');
    expect(signatureKeyAt(signature, 1)).toBe('text-tool-calls|edit|*|*');
    expect(signatureKeyAt(signature, 0)).toBe('text-tool-calls|*|*|*');
    expect(signatureKeyAt(signature, -1)).toBe('*');
  });

  it('classifies steps with keyword rules and no model', () => {
    expect(inferArchetype('Read src/a.ts')).toBe('read');
    expect(inferArchetype('Create hello.txt')).toBe('write');
    expect(inferArchetype('Fix the parser')).toBe('edit');
    expect(inferArchetype('Run the unit tests')).toBe('verify');
    expect(inferArchetype('Execute the build command')).toBe('exec');
    expect(inferArchetype('Search for callers')).toBe('research');
    const built = buildSignature({
      title: 'Edit src/a.ts and src/b.ts',
      goal: 'Update both modules',
      capability: 'text-tool-calls',
      inDegree: 1,
    });
    expect(built.archetype).toBe('edit');
    expect(built.scope).toBe('few-files');
    expect(built.capability).toBe('text-tool-calls');
    expect(built.inDegree).toBe(1);
  });
});

describe('prior', () => {
  it('names quality and the failure count in the basis', () => {
    const prior = coldStartPrior('verdict', {
      signature: { ...edit, capability: 'text-tool-calls' },
      quality: 0.4,
      historicalFailures: 3,
      weight: 1,
      fileCount: 2,
      acceptancePaths: [],
    });
    expect(prior.basis).toContain('quality 0.40');
    expect(prior.basis).toContain('3 recorded failure(s)');
    expect(prior.value.kind).toBe('categorical-multi');
  });
});

describe('policy', () => {
  it('returns proceed for every input in Phase 2', () => {
    const policy = new ObserveOnlyPolicy();
    const prediction = predictionFixture();
    const residual: Residual = {
      predictionId: prediction.id,
      taskId: prediction.taskId,
      signatureKey: prediction.signatureKey,
      observed: { kind: 'categorical', label: 'pass' },
      score: 0.9,
      rule: 'categorical-brier',
      surprise: true,
      threshold: 0.2,
      contrast: 'expected fail (0.90) → observed pass',
      at: 2,
    };
    expect(policy.beforeStep(prediction, contextFixture())).toEqual({ kind: 'proceed' });
    expect(policy.beforeStep(undefined, contextFixture())).toEqual({ kind: 'proceed' });
    expect(policy.afterResidual(residual, contextFixture())).toEqual({ kind: 'proceed' });
    expect(policy.afterResidual(undefined, contextFixture())).toEqual({ kind: 'proceed' });
  });
});

describe('defaults', () => {
  it('ships cognition in observe mode', () => {
    expect(defaultHarnessConfig.cognitionMode).toBe('observe');
    expect(defaultHarnessConfig.cognitionMinSamples).toBe(8);
    expect(defaultHarnessConfig.cognitionLevelSamples).toBe(3);
  });
});

function stepFixture(): Step {
  return {
    id: 'stp',
    taskId: 'tsk',
    idx: 0,
    title: 'Edit src/a.ts',
    goal: 'Update the parser',
    status: 'pending',
    acceptance: [],
    weight: 1,
    deps: [],
  };
}

function contextFixture(): PredictionContext {
  const step = stepFixture();
  const plan: Plan = { id: 'plan', taskId: 'tsk', steps: [step], mode: 'full', revision: 1, createdAt: 1 };
  return {
    taskId: 'tsk',
    sessionId: 'ses',
    workspace: '/ws',
    stepId: step.id,
    capabilities: {
      supportsTools: true,
      supportsJson: true,
      supportsStreaming: true,
      maxContextWindow: 8192,
      quality: 0.4,
    },
    model: 'mock',
    step,
    plan,
    now: 1,
  };
}

function predictionFixture(): Prediction {
  return {
    id: 'pred',
    taskId: 'tsk',
    sessionId: 'ses',
    stepId: 'stp',
    subject: { kind: 'verdict', stepId: 'stp' },
    signature: { capability: 'tool-calling', archetype: 'edit', scope: 'single-file', toolset: [], inDegree: 0 },
    signatureKey: 'tool-calling|edit|single-file|0',
    value: { kind: 'categorical-multi', probs: { pass: 0.1, fail: 0.9, unknown: 0 } },
    confidence: 0.9,
    source: 'empirical-backoff',
    basis: 'L3 n=12, fail 11/12',
    level: 3,
    at: 1,
  };
}

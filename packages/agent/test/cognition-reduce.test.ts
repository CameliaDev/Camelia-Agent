/**
 * Cognition events fold into their own slice and do not disturb the task.
 * @module
 */

import { describe, expect, it } from 'vitest';

import type { DomainEvent, DomainEventMap, DomainEventOf, DomainEventType, Prediction, Residual, SkillRecord } from '@camelia/core';

import { initialSnapshot, reduceEvents } from '../src/view/index.js';

function env<T extends DomainEventType>(type: T, payload: DomainEventMap[T], ts: number): DomainEventOf<T> {
  return { type, payload, traceId: 'tr', ts };
}

describe('reduceEvents cognition', () => {
  it('folds prediction, score, skip, and a learned strategy without inventing a verdict', () => {
    const prediction: Prediction = {
      id: 'pred-1',
      taskId: 'tsk',
      sessionId: 'ses',
      stepId: 'stp',
      subject: { kind: 'verdict', stepId: 'stp' },
      signature: { capability: 'tool-calling', archetype: 'read', scope: 'single-file', toolset: [], inDegree: 0 },
      signatureKey: 'tool-calling|read|single-file|0',
      value: { kind: 'categorical-multi', probs: { pass: 0.8, fail: 0.15, unknown: 0.05 } },
      confidence: 0.8,
      source: 'prior',
      basis: 'prior: quality 0.72, 0 recorded failure(s)',
      level: -1,
      at: 10,
    };
    const residual: Residual = {
      predictionId: 'pred-1',
      taskId: 'tsk',
      signatureKey: '*',
      observed: { kind: 'categorical', label: 'pass' },
      score: 0.04,
      rule: 'categorical-brier',
      surprise: false,
      threshold: null,
      contrast: 'expected pass (0.80) → observed pass',
      at: 20,
    };
    const skill: SkillRecord = {
      memoryId: 'mem-1',
      steps: ['read', 'edit'],
      signatureKey: 'tool-calling|edit|few-files|*',
      attempts: 3,
      successes: 2,
      meanResidual: 0.2,
      lastAttemptAt: 30,
    };
    const events: DomainEvent[] = [
      env('cognition.predicted', { prediction }, 10),
      env('cognition.scored', { residual }, 20),
      env('cognition.skipped', { reason: 'observe', detail: 'phase 2' }, 25),
      env('cognition.skill_updated', { skill }, 30),
      env('cognition.surprised', {
        signatureKey: 'tool-calling|read|single-file|0',
        score: 0.4,
        contrast: 'expected pass → observed fail',
        action: { kind: 'proceed' },
      }, 40),
    ];
    const before = initialSnapshot();
    expect(before.cognition).toBeUndefined();
    const snapshot = reduceEvents(before, events);
    expect(snapshot.task).toBeUndefined();
    expect(snapshot.cognition?.predictions).toEqual([
      expect.objectContaining({
        id: 'pred-1',
        basis: prediction.basis,
        score: 0.04,
        surprise: false,
        contrast: residual.contrast,
      }),
    ]);
    expect(snapshot.cognition?.skipped[0]?.reason).toBe('observe');
    expect(snapshot.cognition?.strategies[0]?.memoryId).toBe('mem-1');
    expect(snapshot.cognition?.surprises[0]?.actionKind).toBe('proceed');
    expect(snapshot.timeline.map((entry) => entry.type)).toEqual(events.map((event) => event.type));
  });
});

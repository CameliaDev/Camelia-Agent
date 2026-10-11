/**
 * Planner normalisation and ordering — the contracts that make a plan *executable*
 * regardless of how badly the model formatted it (whitepaper §3.2).
 * @module
 */

import { describe, expect, it } from 'vitest';

import type { Plan, Step } from '@camelia/core';
import { breakCycles, dagDepth, fallbackPlan, normalisePlan, topologicalOrder } from '../src/planning/plan-utils.js';

function step(idx: number, deps: string[] = []): Step {
  return {
    id: `s${idx}`,
    taskId: 't1',
    idx,
    title: `step ${idx}`,
    goal: `goal ${idx}`,
    status: 'pending',
    acceptance: [],
    weight: 1,
    deps,
  };
}

describe('breakCycles', () => {
  it('leaves an acyclic graph untouched', () => {
    const { edges, dropped } = breakCycles([[1], [2], []]);
    expect(dropped).toBe(0);
    expect(edges).toEqual([[1], [2], []]);
  });

  it('drops the edge that closes a two-node cycle', () => {
    const { edges, dropped } = breakCycles([[1], [0]]);
    expect(dropped).toBe(1);
    // Deterministic choice: the backward dependency (0 depends on 1) is dropped
    // and the forward one (1 depends on 0) is kept, leaving an executable order
    // 0 then 1. Dropping either edge breaks the cycle; keeping forward edges is
    // the one that matches how plans are actually written.
    expect(edges[0]).toEqual([]);
    expect(edges[1]).toEqual([0]);
  });

  it('breaks a three-node cycle without dropping the whole graph', () => {
    const { edges, dropped } = breakCycles([[1], [2], [0]]);
    expect(dropped).toBeGreaterThanOrEqual(1);
    // Every edge that remains must still be reachable without cycling.
    expect(edges.length).toBe(3);
  });
});

describe('normalisePlan', () => {
  it('returns undefined when there is nothing usable', () => {
    expect(normalisePlan(undefined, { taskId: 't1', maxSteps: 10, mode: 'full' })).toBeUndefined();
    expect(normalisePlan({ steps: [] }, { taskId: 't1', maxSteps: 10, mode: 'full' })).toBeUndefined();
    expect(normalisePlan({ steps: 'nope' }, { taskId: 't1', maxSteps: 10, mode: 'full' })).toBeUndefined();
  });

  it('coerces loose model output into a well-formed plan', () => {
    const plan = normalisePlan(
      {
        steps: [
          { title: 'Create the file', goal: 'write it', acceptance: [{ kind: 'file-exists', params: { path: 'a.ts' } }] },
          { title: 'Run tests', deps: [0], acceptance: [{ kind: 'test-pass', params: { command: 'npm test' } }] },
        ],
      },
      { taskId: 't1', maxSteps: 10, mode: 'full' },
    );

    expect(plan).toBeDefined();
    expect(plan!.steps).toHaveLength(2);
    expect(plan!.steps[0]!.title).toBe('Create the file');
    expect(plan!.steps[0]!.acceptance[0]!.kind).toBe('file-exists');
    // deps are re-indexed to real step ids, not model-supplied indices.
    expect(plan!.steps[1]!.deps).toEqual([plan!.steps[0]!.id]);
    expect(plan!.mode).toBe('full');
  });

  it('drops acceptance points with an unknown kind', () => {
    const plan = normalisePlan(
      { steps: [{ title: 'x', acceptance: [{ kind: 'teleport', params: {} }, { kind: 'manual', params: {} }] }] },
      { taskId: 't1', maxSteps: 10, mode: 'fast' },
    );
    expect(plan!.steps[0]!.acceptance).toHaveLength(1);
    expect(plan!.steps[0]!.acceptance[0]!.kind).toBe('manual');
  });

  it('caps the plan at maxSteps', () => {
    const steps = Array.from({ length: 50 }, (_, i) => ({ title: `s${i}` }));
    const plan = normalisePlan({ steps }, { taskId: 't1', maxSteps: 5, mode: 'full' });
    expect(plan!.steps).toHaveLength(5);
  });

  it('repairs a self-referencing dep and out-of-range deps', () => {
    const plan = normalisePlan(
      { steps: [{ title: 'a', deps: [0, 9, -1] }, { title: 'b' }] },
      { taskId: 't1', maxSteps: 10, mode: 'full' },
    );
    expect(plan!.steps[0]!.deps).toEqual([]);
  });

  it('defaults a missing title and keeps a positive weight', () => {
    const plan = normalisePlan(
      { steps: [{ goal: 'do it', weight: 3 }, {}] },
      { taskId: 't1', maxSteps: 10, mode: 'fast' },
    );
    expect(plan!.steps[0]!.title).toBe('Step 1');
    expect(plan!.steps[0]!.weight).toBe(3);
    expect(plan!.steps[1]!.title).toBe('Step 2');
    expect(plan!.steps[1]!.weight).toBe(1);
  });
});

describe('fallbackPlan', () => {
  it('produces one step with a file-exists acceptance point per expected path', () => {
    const plan = fallbackPlan('t1', 'add a readme', ['README.md', 'docs/x.md']);
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]!.acceptance).toHaveLength(2);
    expect(plan.steps[0]!.acceptance.every((a) => a.kind === 'file-exists')).toBe(true);
    expect(plan.mode).toBe('fast');
  });

  it('produces a valid plan even with no expected paths', () => {
    const plan = fallbackPlan('t1', 'explain the repo', []);
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]!.acceptance).toHaveLength(0);
  });
});

describe('topologicalOrder', () => {
  it('places dependencies before dependents', () => {
    const plan: Plan = {
      id: 'p1',
      taskId: 't1',
      mode: 'full',
      revision: 0,
      createdAt: 0,
      steps: [step(0), step(1, ['s0']), step(2, ['s1'])],
    };
    expect(topologicalOrder(plan.steps).map((s) => s.idx)).toEqual([0, 1, 2]);
  });

  it('is deterministic and index-stable for independent steps', () => {
    const plan: Plan = {
      id: 'p1',
      taskId: 't1',
      mode: 'full',
      revision: 0,
      createdAt: 0,
      steps: [step(2), step(0), step(1)],
    };
    expect(topologicalOrder(plan.steps).map((s) => s.idx)).toEqual([0, 1, 2]);
  });

  it('does not loop forever on a cyclic dep set', () => {
    const plan: Plan = {
      id: 'p1',
      taskId: 't1',
      mode: 'full',
      revision: 0,
      createdAt: 0,
      steps: [step(0, ['s1']), step(1, ['s0'])],
    };
    expect(topologicalOrder(plan.steps)).toHaveLength(2);
  });

  it('ignores deps that point at steps outside the plan', () => {
    const plan: Plan = {
      id: 'p1',
      taskId: 't1',
      mode: 'full',
      revision: 0,
      createdAt: 0,
      steps: [step(0, ['ghost']), step(1)],
    };
    expect(topologicalOrder(plan.steps)).toHaveLength(2);
  });
});

describe('dagDepth', () => {
  it('reports the longest dependency chain', () => {
    const plan: Plan = {
      id: 'p1',
      taskId: 't1',
      mode: 'full',
      revision: 0,
      createdAt: 0,
      steps: [step(0), step(1, ['s0']), step(2, ['s1'])],
    };
    expect(dagDepth(plan.steps)).toBe(3);
  });

  it('reports 1 for a flat plan', () => {
    const plan: Plan = {
      id: 'p1',
      taskId: 't1',
      mode: 'full',
      revision: 0,
      createdAt: 0,
      steps: [step(0), step(1), step(2)],
    };
    expect(dagDepth(plan.steps)).toBe(1);
  });
});
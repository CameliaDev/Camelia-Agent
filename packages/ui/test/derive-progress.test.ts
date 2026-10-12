/**
 * `deriveProgress` tests — the single progress derivation.
 *
 * Two things are being protected here. First, that each mode maps onto fields the engine
 * really emits (no invented stages). Second, and more importantly, that the *source* of a
 * number is honest: demo data must never be reported as engine state, because that flag is
 * what drives the 演示 badge.
 * @module
 */

import { describe, expect, it } from 'vitest';

import type { TaskView } from '@camelia/agent/view';

import { deriveProgress, planStageOf, taskInFlight } from '../src/progress/deriveProgress.js';
import { mathDemoAt } from '../src/modes/math/mathDemoFixture.js';

/** A minimal TaskView with only the fields the derivation reads. */
function task(overrides: Partial<TaskView> = {}): TaskView {
  return {
    id: 'tsk_1',
    sessionId: 'ses_1',
    intentRaw: 'do a thing',
    assumptions: [],
    constraints: [],
    status: 'executing',
    phase: 'executing',
    progress: 0.4,
    currentStepIdx: 1,
    stepsTotal: 5,
    steps: [],
    toolCalls: {},
    context: {} as TaskView['context'],
    subAgents: [],
    failures: [],
    approvals: [],
    notices: [],
    narration: [],
    checkpoints: [],
    artifacts: [],
    interventions: [],
    activity: { kind: 'executing', detail: '', since: 0 },
    startedAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe('deriveProgress — conversation mode', () => {
  it('reports engine progress and a 1-based step number', () => {
    const result = deriveProgress({ task: task(), mode: 'chat', language: 'zh' });
    expect(result.progress.kind).toBe('task');
    if (result.progress.kind !== 'task') throw new Error('unreachable');
    expect(result.progress.ratio).toBeCloseTo(0.4, 10);
    expect(result.progress.current).toBe(2);
    expect(result.progress.total).toBe(5);
    expect(result.progress.status).toBe('running');
    expect(result.source).toBe('engine');
  });

  it('is idle and toneless when there is no task', () => {
    const result = deriveProgress({ task: undefined, mode: 'chat', language: 'zh' });
    expect(result.source).toBe('none');
    if (result.progress.kind !== 'task') throw new Error('unreachable');
    expect(result.progress.status).toBe('idle');
    expect(result.progress.ratio).toBe(0);
    expect(result.progress.total).toBe(0);
  });

  it('maps terminal statuses to their tones', () => {
    const failed = deriveProgress({ task: task({ status: 'failed' }), mode: 'chat', language: 'zh' });
    expect(failed.progress.tone).toBe('bad');
    const done = deriveProgress({ task: task({ status: 'done' }), mode: 'chat', language: 'zh' });
    expect(done.progress.tone).toBe('ok');
    const paused = deriveProgress({ task: task({ status: 'paused' }), mode: 'chat', language: 'zh' });
    expect(paused.progress.tone).toBe('warn');
  });

  it('localises the active step label', () => {
    const steps = [
      {
        id: 's1',
        idx: 0,
        title: 'Map the CLI entrypoint and the report generator',
        goal: '',
        status: 'done' as const,
        weight: 1,
        acceptance: [],
      },
      {
        id: 's2',
        idx: 1,
        title: 'Parse a --json flag in the CLI',
        goal: '',
        status: 'running' as const,
        weight: 1,
        acceptance: [],
      },
    ];
    const zh = deriveProgress({ task: task({ steps, currentStepIdx: 1 }), mode: 'chat', language: 'zh' });
    if (zh.progress.kind !== 'task') throw new Error('unreachable');
    expect(zh.progress.label).toBe('在 CLI 中解析 --json 参数');
  });
});

describe('deriveProgress — plan mode', () => {
  it('maps task status onto the plan lifecycle without inventing a state', () => {
    expect(planStageOf(task({ status: 'planning' }))).toBe('draft');
    expect(planStageOf(task({ status: 'awaiting-approval' }))).toBe('awaiting_approval');
    expect(planStageOf(task({ status: 'executing' }))).toBe('executing');
    expect(planStageOf(task({ status: 'verifying' }))).toBe('executing');
    expect(planStageOf(task({ status: 'done' }))).toBe('done');
    expect(planStageOf(task({ status: 'cancelled' }))).toBe('rejected');
    expect(planStageOf(undefined)).toBe('draft');
  });

  it('never claims execution before approval', () => {
    const result = deriveProgress({
      task: task({ status: 'awaiting-approval' }),
      mode: 'plan',
      language: 'zh',
    });
    if (result.progress.kind !== 'plan') throw new Error('unreachable');
    expect(result.progress.stage).toBe('awaiting_approval');
    expect(result.progress.tone).toBe('warn');
  });
});

describe('deriveProgress — math mode', () => {
  it('falls back to step counting when the engine has not sent math stages', () => {
    const result = deriveProgress({
      task: task({ progress: 0.5, stepsTotal: 7 }),
      mode: 'math',
      language: 'zh',
    });
    if (result.progress.kind !== 'math') throw new Error('unreachable');
    // 0.5 of the 7-step pipeline sits inside 'solving' (3/7 ≈ .4286 → 4/7 ≈ .5714).
    expect(result.progress.stage).toBe('solving');
    expect(result.progress.overall).toBeCloseTo(0.5, 10);
    // Derived, not demo — and therefore not badged as demo.
    expect(result.source).toBe('derived');
    expect(result.demo).toBe(false);
  });

  it('reports demo data as demo, so the badge cannot be dropped by accident', () => {
    const result = deriveProgress({
      task: undefined,
      mode: 'math',
      language: 'zh',
      mathDemo: mathDemoAt('solving', 0.5),
    });
    expect(result.source).toBe('demo');
    expect(result.demo).toBe(true);
    if (result.progress.kind !== 'math') throw new Error('unreachable');
    expect(result.progress.stage).toBe('solving');
    // solving spans 3/7 → 4/7; halfway is 3.5/7 = 0.5.
    expect(result.progress.overall).toBeCloseTo(0.5, 10);
  });

  it('stays idle and unbadged when there is nothing at all', () => {
    const result = deriveProgress({ task: undefined, mode: 'math', language: 'zh' });
    expect(result.source).toBe('none');
    expect(result.demo).toBe(false);
    if (result.progress.kind !== 'math') throw new Error('unreachable');
    expect(result.progress.overall).toBe(0);
  });

  it('prefers a real task over the demo when both are present', () => {
    const result = deriveProgress({
      task: task({ progress: 0.25, stepsTotal: 7 }),
      mode: 'math',
      language: 'zh',
      mathDemo: mathDemoAt('reporting', 1),
    });
    expect(result.source).toBe('derived');
    expect(result.demo).toBe(false);
  });
});

describe('taskInFlight', () => {
  it('counts paused as in flight and terminal states as not', () => {
    expect(taskInFlight(task({ status: 'executing' }))).toBe(true);
    expect(taskInFlight(task({ status: 'paused' }))).toBe(true);
    expect(taskInFlight(task({ status: 'awaiting-approval' }))).toBe(true);
    expect(taskInFlight(task({ status: 'done' }))).toBe(false);
    expect(taskInFlight(task({ status: 'failed' }))).toBe(false);
    expect(taskInFlight(task({ status: 'cancelled' }))).toBe(false);
    expect(taskInFlight(undefined)).toBe(false);
  });
});

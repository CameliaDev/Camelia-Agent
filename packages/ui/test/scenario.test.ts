/**
 * Scenario-script tests (whitepaper §6.1).
 *
 * The fixtures are the substrate of every screenshot and every UI test, so the two
 * properties that matter are: (a) they are deterministic — folding the same script twice
 * yields byte-identical snapshots, and (b) they actually exercise the architecture
 * surface the UI is required to expose (phases, steps, tools, approvals, compaction,
 * sub-agents, reliability notices, delivery).
 * @module
 */

import { describe, expect, it } from 'vitest';

import { initialSnapshot, reduceEvents } from '@camelia/agent/view';

import {
  SCENES,
  buildScenario,
  isSceneId,
  planFor,
  sceneStatus,
  type SceneId,
} from '../src/transport/scenario.js';

function fold(scene: SceneId) {
  return reduceEvents(initialSnapshot(), buildScenario(scene));
}

describe('scenario — determinism', () => {
  it('folds the same script to identical snapshots', () => {
    for (const scene of SCENES.map((s) => s.id)) {
      expect(fold(scene)).toEqual(fold(scene));
    }
  });

  it('builds a fresh, structurally identical script on every call', () => {
    const a = buildScenario('done');
    const b = buildScenario('done');
    expect(a).toHaveLength(b.length);
    expect(a).toEqual(b);
  });

  it('never mutates a previously returned script', () => {
    const first = buildScenario('running');
    const len = first.length;
    const snapshot = reduceEvents(initialSnapshot(), first);
    // A second build must not have appended to the array the first caller still holds.
    buildScenario('done');
    expect(first).toHaveLength(len);
    expect(snapshot.task?.steps.length).toBeGreaterThan(0);
  });
});

describe('scenario — scene slicing', () => {
  const order: SceneId[] = ['empty', 'planning', 'plan', 'diff', 'running', 'approval', 'failure', 'done'];

  it('is monotonic along the task timeline', () => {
    const lengths = order.map((s) => buildScenario(s).length);
    for (let i = 1; i < lengths.length; i += 1) {
      expect(lengths[i]!).toBeGreaterThanOrEqual(lengths[i - 1]!);
    }
  });

  it('starts from nothing for the empty scene', () => {
    expect(buildScenario('empty')).toEqual([]);
  });

  it('slices are prefixes of the full run', () => {
    const full = buildScenario('done');
    for (const scene of order) {
      const slice = buildScenario(scene);
      expect(slice).toEqual(full.slice(0, slice.length));
    }
  });
});

describe('scenario — the done scene exposes the full architecture surface', () => {
  const snapshot = fold('done');
  const task = snapshot.task!;

  it('reaches a delivered task', () => {
    expect(task.status).toBe('done');
    expect(task.phase).toBe('delivering');
    expect(task.progress).toBe(1);
  });

  it('records five steps, all done, each with a passing verdict', () => {
    expect(task.steps).toHaveLength(5);
    expect(task.steps.every((s) => s.status === 'done')).toBe(true);
    expect(task.steps.every((s) => s.verdict?.status === 'pass')).toBe(true);
  });

  it('exposes tool input, output and duration', () => {
    const calls = Object.values(task.toolCalls);
    expect(calls.length).toBeGreaterThan(0);
    const finished = calls.filter((c) => c.status === 'ok');
    expect(finished.length).toBeGreaterThan(0);
    expect(finished.every((c) => c.output !== undefined)).toBe(true);
    expect(finished.every((c) => (c.durationMs ?? 0) > 0)).toBe(true);
  });

  it('records the compaction with inspectable summaries and protected slots', () => {
    expect(task.context.compactions).toHaveLength(1);
    const compaction = task.context.compactions[0]!;
    expect(compaction.summaries.length).toBeGreaterThan(0);
    expect(compaction.protectedSlots).toContain('goal');
    expect(task.context.used).toBeLessThanOrEqual(task.context.window);
  });

  it('shows the sub-agent that ran and finished', () => {
    expect(task.subAgents).toHaveLength(1);
    expect(task.subAgents[0]!.status).toBe('ok');
    expect(task.subAgents[0]!.summary).toBeTruthy();
  });

  it('surfaces the reliability notices the run produced', () => {
    const kinds = task.notices.map((n) => n.kind);
    expect(kinds).toContain('drift');
    expect(kinds).toContain('hallucination');
    expect(kinds).toContain('rollback');
  });

  it('keeps the recovery visible as a failure that was healed', () => {
    expect(task.failures.length).toBeGreaterThan(0);
    expect(task.failures[0]!.strategy).toBeTruthy();
  });

  it('delivers artifacts and a summary', () => {
    expect(task.artifacts.length).toBeGreaterThanOrEqual(4);
    expect(task.summary).toContain('--json');
  });

  it('tracks the provider fallback chain', () => {
    expect(snapshot.provider.fallbacks.length).toBeGreaterThan(0);
    expect(snapshot.provider.activeProvider).toBe('openrouter');
  });

  it('streams narration, closed once the task is done', () => {
    expect(task.narration.length).toBeGreaterThan(0);
    expect(task.narration.every((n) => n.streaming === false)).toBe(true);
  });

  it('keeps a raw event trail for audit', () => {
    expect(snapshot.timeline.length).toBe(buildScenario('done').length);
  });
});

describe('scenario — intermediate scenes', () => {
  it('planning has a goal but no steps yet', () => {
    const task = fold('planning').task!;
    expect(task.steps).toHaveLength(0);
    expect(task.goal).toBeTruthy();
    expect(task.phase).toBe('planning');
  });

  it('approval parks the run on a privileged call', () => {
    const task = fold('approval').task!;
    expect(task.approvals).toHaveLength(1);
    expect(task.approvals[0]!.risk).toBe('privileged');
    expect(task.activity.kind).toBe('waiting-approval');
  });

  it('failure keeps the failed call and its recovery evidence', () => {
    const task = fold('failure').task!;
    const errored = Object.values(task.toolCalls).filter((c) => c.status === 'error');
    expect(errored.length).toBeGreaterThan(0);
    expect(task.failures.some((f) => f.attempts > 0)).toBe(true);
  });

  it('diff parks on an open edit inside a step that is still running', () => {
    const task = fold('diff').task!;
    const current = task.steps.find((s) => s.idx === task.currentStepIdx)!;
    expect(current.status).toBe('running');
    const edit = Object.values(task.toolCalls).find((c) => c.stepId === current.id && c.name === 'fs.edit');
    expect(edit).toBeDefined();
    const input = edit!.input as { oldText?: string; newText?: string };
    expect(typeof input.oldText).toBe('string');
    expect(typeof input.newText).toBe('string');
  });

  it('diff carries the compaction and the finished sub-agent that preceded the edit', () => {
    const task = fold('diff').task!;
    expect(task.context.compactions).toHaveLength(1);
    expect(task.subAgents[0]!.status).toBe('ok');
  });

  it('error replays nothing — there is no task to fold', () => {
    expect(buildScenario('error')).toEqual([]);
    expect(fold('error').task).toBeUndefined();
  });

  it('connecting replays nothing and folds to no task', () => {
    expect(buildScenario('connecting')).toEqual([]);
    expect(fold('connecting').task).toBeUndefined();
  });
});

describe('scenario — helpers', () => {
  it('validates scene ids', () => {
    expect(isSceneId('running')).toBe(true);
    expect(isSceneId('diff')).toBe(true);
    expect(isSceneId('error')).toBe(true);
    expect(isSceneId('nope')).toBe(false);
    expect(isSceneId(null)).toBe(false);
  });

  it('maps a scene to its connection status', () => {
    expect(sceneStatus('empty')).toBe('offline');
    expect(sceneStatus('connecting')).toBe('connecting');
    expect(sceneStatus('error')).toBe('offline');
    expect(sceneStatus('done')).toBe('finished');
    expect(sceneStatus('diff')).toBe('live');
    expect(sceneStatus('running')).toBe('live');
  });

  it('retags the standard plan for a new task', () => {
    const plan = planFor('tsk_abc123', 42);
    expect(plan.taskId).toBe('tsk_abc123');
    expect(plan.createdAt).toBe(42);
    expect(plan.steps.every((s) => s.taskId === 'tsk_abc123')).toBe(true);
    expect(plan.steps.every((s) => s.status === 'pending')).toBe(true);
  });
});
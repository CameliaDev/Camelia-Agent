/**
 * Memory-view projection tests (Iteration 26 — Stage 1 coverage recovery).
 *
 * The memory panel's view layer (`toMemoryView`, the `memory.*` timeline
 * summaries, the routing/tool no-op branches of `applyEvent`) used to be driven
 * almost entirely by cli real-engine tests and ui tests at runtime — the agent
 * package itself asserted very little, which is exactly the root cause Iteration
 * 22 pinned for the coverage regression. These tests assert the observable
 * projection behaviour directly inside the agent package.
 * @module
 */

import { describe, expect, it } from 'vitest';

import type { DomainEvent, DomainEventMap, DomainEventOf, DomainEventType, MemoryItem } from '@camelia/core';

import {
  applyEvent,
  initialSnapshot,
  reduceEvents,
  toMemoryView,
  type ProjectionSnapshot,
} from '../src/view/index.js';

function env<T extends DomainEventType>(type: T, payload: DomainEventMap[T], ts: number): DomainEventOf<T> {
  return { type, payload, traceId: `trace-${ts}`, ts };
}

function memoryItem(overrides: Partial<MemoryItem> & { id: string; content: string }): MemoryItem {
  return {
    scope: 'global',
    kind: 'fact',
    keywords: '',
    createdAt: 10,
    updatedAt: 10,
    ...overrides,
  };
}

function fold(events: DomainEvent[]): ProjectionSnapshot {
  return reduceEvents(initialSnapshot(), events);
}

// ---------------------------------------------------------------------------
// toMemoryView — the memory panel's row shape (Iteration 26: direct assertion)
// ---------------------------------------------------------------------------

describe('toMemoryView', () => {
  it('keeps the engine-computed strength/recency decomposition untouched', () => {
    const view = toMemoryView(
      memoryItem({ id: 'm1', content: 'the build command is pnpm build' }),
      { strength: 0.42, recency: 0.7 },
    );
    expect(view.strength).toBe(0.42);
    expect(view.recency).toBe(0.7);
  });

  it('derives the layer from scope when absent — global → long, session → short', () => {
    const global = toMemoryView(memoryItem({ id: 'g1', content: 'x', scope: 'global' }), { strength: 1, recency: 1 });
    expect(global.layer).toBe('long');

    const session = toMemoryView(
      memoryItem({ id: 's1', content: 'x', scope: 'session', sessionId: 'sess-1' }),
      { strength: 1, recency: 1 },
    );
    expect(session.layer).toBe('short');
  });

  it('keeps an explicit procedural layer and the sessionId', () => {
    const view = toMemoryView(
      memoryItem({ id: 'p1', content: 'recipe', kind: 'procedural', layer: 'procedural', scope: 'session', sessionId: 'sess-2' }),
      { strength: 0.9, recency: 0.6 },
    );
    expect(view.layer).toBe('procedural');
    expect(view.sessionId).toBe('sess-2');
  });

  it('applies defaults for importance, correctness, hits and retrievable', () => {
    const view = toMemoryView(memoryItem({ id: 'd1', content: 'x' }), { strength: 0.5, recency: 0.5 });
    expect(view.importance).toBe(0.5);
    expect(view.correctness).toBe(0.5);
    expect(view.hits).toBe(0);
    expect(view.retrievable).toBe(true);
    expect(view.lastHitAt).toBeUndefined();
    expect(view.nextReviewAt).toBeUndefined();
    expect(view.evidence).toBeUndefined();
  });

  it('spreads the optional fields when present — lastHitAt, nextReviewAt, evidence, retrievable=false', () => {
    const view = toMemoryView(
      memoryItem({
        id: 'o1',
        content: 'staging key in the vault',
        lastHitAt: 25,
        nextReviewAt: 30,
        retrievable: false,
        hits: 3,
        evidence: { taskId: 'tsk_1', verdict: 'pass', at: 20 },
      }),
      { strength: 0.8, recency: 0.4 },
    );
    expect(view.lastHitAt).toBe(25);
    expect(view.nextReviewAt).toBe(30);
    expect(view.retrievable).toBe(false);
    expect(view.hits).toBe(3);
    expect(view.evidence).toEqual({ taskId: 'tsk_1', verdict: 'pass', at: 20 });
  });

  it('omits a null nextReviewAt rather than rendering a stale due date', () => {
    const view = toMemoryView(
      memoryItem({ id: 'n1', content: 'x', nextReviewAt: null }),
      { strength: 0.5, recency: 0.5 },
    );
    expect(view.nextReviewAt).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// memory.* timeline summaries (Iteration 26: remaining summarise branches)
// ---------------------------------------------------------------------------

describe('memory timeline summaries', () => {
  it('summarises memory.recalled without provenance — no via, no layer tags', () => {
    const snapshot = fold([env('memory.recalled', { count: 2, ids: ['a', 'b'], noise: 0.5, provenance: [] }, 0)]);
    const summary = snapshot.timeline[0]?.summary;
    expect(summary).toBe('recalled 2 (noise 0.5)');
    expect(summary).not.toContain('via');
    expect(summary).not.toContain('[');
  });

  it('filters empty matchedBy tokens out of the via annotation', () => {
    const snapshot = fold([
      env('memory.recalled', {
        count: 1,
        ids: ['a'],
        noise: 0,
        provenance: [{ memoryId: 'a', layer: 'long', matchedBy: '' }],
      }, 0),
    ]);
    const summary = snapshot.timeline[0]?.summary;
    // The layer tag stays; the empty matchedBy contributes nothing to "via".
    expect(summary).toContain('long');
    expect(summary).not.toContain('via');
  });

  it('summarises memory.promoted with the reason', () => {
    const snapshot = fold([env('memory.promoted', { memoryId: 'a', layer: 'long', reason: 'session-lifecycle' }, 0)]);
    expect(snapshot.timeline[0]?.summary).toBe('promote a → long (session-lifecycle)');
  });

  it('folds memory.recalled / memory.downgraded / memory.forgotten / memory.reactivated into the timeline only', () => {
    const snapshot = fold([
      env('task.received', { task: { id: 't1', sessionId: 's1', intentRaw: 'go', status: 'received', phase: 'idle', progress: 0, createdAt: 0, updatedAt: 0 } }, 0),
      env('memory.recalled', { count: 1, ids: ['a'], noise: 0.2, provenance: [{ memoryId: 'a', layer: 'short', matchedBy: 'x' }] }, 1),
      env('memory.downgraded', { memoryId: 'a', reason: 'task-verification-gap', correctness: 0 }, 2),
      env('memory.forgotten', { memoryId: 'a', contentSnippet: 'snippet', reason: 'budget-eviction', value: 0.1 }, 3),
      env('memory.reactivated', { memoryId: 'a', nextReviewAt: 5 }, 4),
    ]);
    expect(snapshot.task?.status).toBe('received'); // task untouched by memory events
    expect(snapshot.timeline.map((e) => e.type)).toEqual([
      'task.received',
      'memory.recalled',
      'memory.downgraded',
      'memory.forgotten',
      'memory.reactivated',
    ]);
  });
});

// ---------------------------------------------------------------------------
// applyEvent branches that were only reachable via cli/ui (Iteration 26)
// ---------------------------------------------------------------------------

describe('applyEvent — routing and tool no-op branches', () => {
  it('records the routing decision on the task', () => {
    const snapshot = fold([
      env('task.received', { task: { id: 't1', sessionId: 's1', intentRaw: 'go', status: 'received', phase: 'idle', progress: 0, createdAt: 0, updatedAt: 0 } }, 0),
      env('routing.chosen', { stepId: 'step-0', model: 'qwen3-coder:free', line: 'cheap-first', estimatedUsd: 0.0001, tokens: 42 }, 1),
    ]);
    expect(snapshot.task?.routing).toEqual({
      line: 'cheap-first',
      estimatedUsd: 0.0001,
      tokens: 42,
      model: 'qwen3-coder:free',
    });
  });

  it('approving a call that is not tracked leaves toolCalls untouched but clears approvals', () => {
    const snapshot = fold([
      env('task.received', { task: { id: 't1', sessionId: 's1', intentRaw: 'go', status: 'received', phase: 'idle', progress: 0, createdAt: 0, updatedAt: 0 } }, 0),
      env('tool.approval_required', { call: { id: 'call-1', stepId: 'step-0', taskId: 't1', name: 'shell.exec', input: {}, status: 'awaiting-approval', risk: 'write', reversible: true, traceId: 'tr', createdAt: 1 } }, 1),
      // An approval for a *different* call — the tracked approval is not affected.
      env('tool.approved', { callId: 'call-ghost', by: 'user' }, 2),
    ]);
    expect(Object.keys(snapshot.task!.toolCalls)).toEqual(['call-1']);
    expect(snapshot.task!.toolCalls['call-1']!.approval).toBe('required');
  });

  it('denying an untracked call keeps toolCalls intact and records the reason nowhere', () => {
    const snapshot = fold([
      env('task.received', { task: { id: 't1', sessionId: 's1', intentRaw: 'go', status: 'received', phase: 'idle', progress: 0, createdAt: 0, updatedAt: 0 } }, 0),
      env('tool.denied', { callId: 'call-ghost', reason: 'escapes workspace' }, 1),
    ]);
    expect(snapshot.task?.toolCalls).toEqual({});
  });

  it('starting an untracked call is a no-op on toolCalls but still flips activity', () => {
    const snapshot = fold([
      env('task.received', { task: { id: 't1', sessionId: 's1', intentRaw: 'go', status: 'received', phase: 'idle', progress: 0, createdAt: 0, updatedAt: 0 } }, 0),
      env('tool.started', { callId: 'call-ghost', name: 'fs.read' }, 1),
    ]);
    expect(snapshot.task?.toolCalls).toEqual({});
    expect(snapshot.task?.activity.detail).toContain('fs.read');
  });

  it('failing an untracked call records the failure but not a tool row', () => {
    const snapshot = fold([
      env('task.received', { task: { id: 't1', sessionId: 's1', intentRaw: 'go', status: 'received', phase: 'idle', progress: 0, createdAt: 0, updatedAt: 0 } }, 0),
      env('tool.failed', { callId: 'call-ghost', name: 'fs.read', error: 'ENOENT', recoverable: true }, 1),
    ]);
    expect(snapshot.task?.toolCalls).toEqual({});
    expect(snapshot.task?.failures[0]?.reason).toContain('fs.read');
    expect(snapshot.task?.failures[0]?.recoverable).toBe(true);
  });

  it('appends a step.started that arrives before any plan (upsert append branch)', () => {
    const snapshot = fold([
      env('task.received', { task: { id: 't1', sessionId: 's1', intentRaw: 'go', status: 'received', phase: 'idle', progress: 0, createdAt: 0, updatedAt: 0 } }, 0),
      env('step.started', {
        step: {
          id: 'step-0', taskId: 't1', idx: 0, title: 'first', goal: 'do first', status: 'running',
          weight: 1, deps: [], acceptance: [{ id: 'ap', description: 'done', kind: 'file-exists', params: {} }],
        },
      }, 1),
    ]);
    expect(snapshot.task?.steps).toHaveLength(1);
    expect(snapshot.task?.steps[0]?.title).toBe('first');
    expect(snapshot.task?.steps[0]?.status).toBe('running');
    expect(snapshot.task?.stepsTotal).toBe(0); // stepsTotal reflects the plan, not the live fold
  });

  it('projects a received task that already carries a plan', () => {
    const snapshot = fold([
      env('task.received', {
        task: {
          id: 't1', sessionId: 's1', intentRaw: 'go', status: 'received', phase: 'idle', progress: 0, createdAt: 0, updatedAt: 0,
          plan: {
            id: 'plan-1', taskId: 't1', mode: 'full', revision: 1, createdAt: 1,
            steps: [{
              id: 'step-0', taskId: 't1', idx: 0, title: 'first', goal: 'do first', status: 'pending',
              weight: 1, deps: [], acceptance: [{ id: 'ap', description: 'done', kind: 'file-exists', params: {} }],
            }],
          },
          intentClarified: { goal: 'clarified goal', assumptions: [], constraints: [], expectedPaths: [], complete: true },
        },
      }, 0),
    ]);
    expect(snapshot.task?.goal).toBe('clarified goal');
    expect(snapshot.task?.steps).toHaveLength(1);
    expect(snapshot.task?.stepsTotal).toBe(1);
    expect(snapshot.task?.steps[0]?.acceptance[0]?.kind).toBe('file-exists');
  });

  it('mutateTask without a task still appends the event to the timeline', () => {
    const snapshot = applyEvent(initialSnapshot(), env('task.status_changed', { from: 'received', to: 'done', reason: 'x' }, 0));
    expect(snapshot.task).toBeUndefined();
    expect(snapshot.timeline).toHaveLength(1);
  });
});

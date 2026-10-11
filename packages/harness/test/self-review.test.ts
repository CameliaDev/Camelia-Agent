/**
 * Plan self-review — "think before acting" (Iteration 20).
 *
 * Unit tests for the four questions plus integration tests proving the three
 * decision points (planning complete / verification failed / reflection), the
 * fast-path exemption, replayability, and concern pinning.
 * @module
 */

import { describe, expect, it } from 'vitest';

import type { ClarifiedIntent, Plan, Step } from '@camelia/core';

import { PlanSelfReview } from '../src/selfreview/PlanSelfReview.js';

import { FakeShell, ScriptedLLM, acceptancePoint, makeHarness, makeIntent, type Harness } from './helpers/context.js';
import { buildEngine } from './helpers/engine.js';

// ---------------------------------------------------------------------------
// unit: the four questions
// ---------------------------------------------------------------------------

function plan(steps: Step[], mode: Plan['mode'] = 'full'): Plan {
  return {
    id: 'p1',
    taskId: 'task1',
    steps,
    mode,
    revision: 0,
    createdAt: 1,
  };
}

function step(title: string, acceptance: Step['acceptance'], idx = 0): Step {
  return {
    id: `s${idx}`,
    taskId: 'task1',
    idx,
    title,
    goal: title,
    deps: [],
    acceptance,
    status: 'pending',
    weight: 1,
  };
}

const fileExists = (path: string) => acceptancePoint('file-exists', { path });

describe('PlanSelfReview — four questions', () => {
  const review = new PlanSelfReview();
  const intent: ClarifiedIntent = makeIntent({ expectedPaths: ['a.txt'] });

  it('approves a small, verifiable, in-scope plan', () => {
    const result = review.review('planning', plan([step('Write a.txt', [fileExists('a.txt')])]), intent);
    expect(result.verdict).toBe('approve');
    expect(result.questions.map((q) => q.id)).toEqual(['scope', 'contract', 'simplicity', 'verifiability']);
    expect(result.questions.every((q) => q.status === 'pass')).toBe(true);
  });

  it('fails when a step has no machine-checkable acceptance point', () => {
    const result = review.review(
      'planning',
      plan([step('Do the thing', [acceptancePoint('manual', {})])]),
      intent,
    );
    expect(result.verdict).toBe('revise');
    expect(result.questions.find((q) => q.id === 'verifiability')?.status).toBe('fail');
  });

  it('fails when the plan violates a stated constraint', () => {
    const constrained = makeIntent({ expectedPaths: ['a.txt'], constraints: ['do not touch test files'] });
    const result = review.review(
      'planning',
      plan([step('Update the test file', [fileExists('test/a.spec.ts')])]),
      constrained,
    );
    expect(result.verdict).toBe('revise');
    expect(result.questions.find((q) => q.id === 'scope')?.status).toBe('fail');
  });

  it('warns when acceptance paths escape the expected paths, without failing', () => {
    const result = review.review('planning', plan([step('Write elsewhere', [fileExists('src/other.ts')])]), intent);
    expect(result.verdict).toBe('approve');
    expect(result.questions.find((q) => q.id === 'scope')?.status).toBe('warn');
  });

  it('warns on test/contract signals and on an oversized plan', () => {
    const noisy = review.review(
      'planning',
      plan([step('Add a unit test for the parser', [fileExists('tests/parser.test.ts')])]),
      intent,
    );
    expect(noisy.questions.find((q) => q.id === 'contract')?.status).toBe('warn');

    const inflated = review.review(
      'planning',
      plan([
        step('a', [fileExists('a.txt')], 0),
        step('b', [fileExists('a.txt')], 1),
        step('c', [fileExists('a.txt')], 2),
        step('d', [fileExists('a.txt')], 3),
      ]),
      intent,
    );
    expect(inflated.questions.find((q) => q.id === 'simplicity')?.status).toBe('warn');
  });

  it('exempts fast-path plans from the review', () => {
    const fast = plan([step('Write a.txt', [fileExists('a.txt')])], 'fast');
    expect(review.shouldReview(fast)).toBe(false);
    expect(review.shouldReview(plan([step('Write a.txt', [fileExists('a.txt')])], 'full'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// integration: trigger & skip at the three decision points, replayable
// ---------------------------------------------------------------------------

function planTurn(steps: { title: string; acceptance: ReturnType<typeof fileExists>[] }[]): { text: string } {
  return { text: JSON.stringify({ steps }) };
}

function writeTurn(path: string, content: string) {
  return { toolCalls: [{ name: 'fs.write', arguments: { path, content } }] };
}

const finishTurn = { text: 'done' };

function eventTypes(h: Harness): string[] {
  return h.events.map((e) => e.type);
}

function selfReviews(h: Harness): { decisionPoint: string; verdict: string; mode: string }[] {
  return h.events
    .filter((e) => e.type === 'selfreview.performed')
    .map((e) => e.payload as { decisionPoint: string; verdict: string; mode: string });
}

/** Wire the bus to the store exactly like the production runtime does. */
function persistEvents(h: Harness): void {
  h.bus.onAny((event) => {
    void h.store.appendEvent(h.ctx.sessionId, {
      type: event.type,
      payload: event.payload,
      traceId: event.traceId,
      taskId: event.taskId,
      ts: event.ts,
      seq: 0,
    });
  });
}

describe('AgentLoop — self-review integration', () => {
  it('triggers at planning + reflection for a full plan and is replayable', async () => {
    const llm = new ScriptedLLM([
      planTurn([
        { title: 'Write a.txt', acceptance: [fileExists('a.txt')] },
        { title: 'Write b.txt', acceptance: [fileExists('b.txt')] },
      ]),
      writeTurn('a.txt', 'A'),
      finishTurn,
      writeTurn('b.txt', 'B'),
      finishTurn,
    ]);
    const h = makeHarness({ llm });
    persistEvents(h);
    const { loop } = buildEngine(h);

    const outcome = await loop.run(makeIntent({ goal: 'create two files', expectedPaths: ['a.txt', 'b.txt'] }));
    expect(outcome.status).toBe('done');

    const reviews = selfReviews(h);
    expect(reviews.map((r) => r.decisionPoint)).toEqual(['planning', 'reflect']);
    expect(reviews.every((r) => r.mode === 'full')).toBe(true);
    expect(reviews.every((r) => r.verdict === 'approve')).toBe(true);

    // Replay: the persisted event log carries the self-review events.
    const stored = await h.store.listEvents();
    expect(stored.map((e) => e.type)).toContain('selfreview.performed');
  });

  it('skips for fast-path plans and still emits the observable skip', async () => {
    const llm = new ScriptedLLM([
      planTurn([{ title: 'Write a.txt', acceptance: [fileExists('a.txt')] }]),
      writeTurn('a.txt', 'hello'),
      finishTurn,
    ]);
    const h = makeHarness({ llm });
    const { loop } = buildEngine(h);

    const outcome = await loop.run(makeIntent({ goal: 'create a.txt', expectedPaths: ['a.txt'] }));
    expect(outcome.status).toBe('done');
    expect(eventTypes(h)).toContain('selfreview.skipped');
    expect(eventTypes(h)).not.toContain('selfreview.performed');
    const skip = h.events.find((e) => e.type === 'selfreview.skipped');
    expect((skip!.payload as { reason: string }).reason).toBe('fast-path');
  });

  it('triggers at the verification-fail decision point when a step fails then recovers', async () => {
    // command-exit-zero failures classify as tool errors → retryable, so the
    // loop re-executes the step after the self-review.
    let calls = 0;
    const shell = new FakeShell(() => ({ code: (calls += 1) === 1 ? 1 : 0, stdout: 'ok' }));
    const llm = new ScriptedLLM([
      planTurn([{ title: 'Make check pass', acceptance: [commandExitZero('node check.mjs')] }]),
      writeTurn('a.txt', 'v1'),
      finishTurn,
      writeTurn('a.txt', 'v2'),
      finishTurn,
    ]);
    const h = makeHarness({ llm, shell });
    const { loop } = buildEngine(h);

    // expectedPaths ≥ 2 pushes the planner off the fast path.
    const outcome = await loop.run(makeIntent({ goal: 'make the check pass', expectedPaths: ['a.txt', 'b.txt'] }));
    expect(outcome.status).toBe('done');
    const reviews = selfReviews(h);
    expect(reviews.map((r) => r.decisionPoint)).toContain('verification-fail');
    expect(reviews.map((r) => r.decisionPoint)).toContain('planning');
    expect(reviews.map((r) => r.decisionPoint)).toContain('reflect');
  });

  it('pins concerns into context when the plan review says revise', async () => {
    const llm = new ScriptedLLM([
      // Plan with only a manual acceptance point → verifiability fail at planning.
      planTurn([{ title: 'Do the thing by hand', acceptance: [acceptancePoint('manual', {})] }]),
      writeTurn('a.txt', 'x'),
      finishTurn,
    ]);
    const h = makeHarness({ llm });
    const { loop } = buildEngine(h);

    const outcome = await loop.run(makeIntent({ goal: 'do the thing', expectedPaths: ['a.txt', 'b.txt'] }));
    expect(outcome.status).toBe('done');
    const pinned = h.llm.requests.some((request) =>
      request.messages.some((m) => m.role === 'system' && String(m.content).includes('[self-review')),
    );
    expect(pinned).toBe(true);
  });
});

function commandExitZero(command: string) {
  return acceptancePoint('command-exit-zero', { command });
}

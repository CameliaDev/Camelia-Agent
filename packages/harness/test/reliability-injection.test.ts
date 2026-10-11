/**
 * Phase 2 — reliability injections (whitepaper §4).
 *
 * These are not unit tests of the detectors. They *inject* the ways a task goes
 * wrong into a fully assembled engine and assert the engine either recovers or
 * fails safe: goal drift is caught and re-anchored, a repeated action is broken
 * before it becomes an infinite loop, a swollen context is compacted without
 * losing protected facts, and transient failures are retried instead of aborting
 * the task. The point is the *end-to-end* behaviour, not the detector's score.
 * @module
 */

import { describe, expect, it } from 'vitest';

import type { MetricSample } from '@camelia/core';

import { FakeShell, ScriptedLLM, makeHarness, makeIntent, type Harness } from './helpers/context.js';
import { buildEngine } from './helpers/engine.js';

const WS = 'C:/workspace';

interface RawStepSpec {
  title: string;
  goal?: string;
  deps?: number[];
  acceptance: { kind: string; params: Record<string, unknown>; description?: string }[];
}

function planTurn(steps: RawStepSpec[]): { text: string } {
  return { text: JSON.stringify({ steps }) };
}

function writeTurn(path: string, content: string) {
  return { toolCalls: [{ name: 'fs.write', arguments: { path, content } }] };
}

function readTurn(path: string) {
  return { toolCalls: [{ name: 'fs.read', arguments: { path } }] };
}

function fileExists(path: string): RawStepSpec['acceptance'][number] {
  return { kind: 'file-exists', params: { path }, description: `${path} exists` };
}

function commandExitZero(command: string): RawStepSpec['acceptance'][number] {
  return { kind: 'command-exit-zero', params: { command }, description: `${command} exits 0` };
}

function manual(): RawStepSpec['acceptance'][number] {
  return { kind: 'manual', params: {}, description: 'human judgement' };
}

function eventTypes(h: Harness): string[] {
  return h.events.map((e) => e.type);
}

function findEvent(h: Harness, type: string): { type: string; payload: unknown } | undefined {
  return h.events.find((e) => e.type === type);
}

function metric(h: Harness, name: string): MetricSample | undefined {
  return h.metrics.snapshot().find((m) => m.name === name);
}

// ---------------------------------------------------------------------------
// §4.1 — goal drift
// ---------------------------------------------------------------------------

describe('Phase 2 — goal-drift injection', () => {
  it('catches an off-goal step and re-anchors the protected goal', async () => {
    // The step succeeds on its own terms (it writes the file it declared), but the
    // work has wandered: the output is about a database pool and the files touched
    // diverge from the plan. Drift must be detected *after* the step passes.
    const llm = new ScriptedLLM([
      planTurn([{ title: 'Touch the db pool', acceptance: [fileExists('src/db/pool.ts')] }]),
      writeTurn('src/db/pool.ts', 'pool'),
      { text: 'refactored the database connection pool and tuned indexes' },
    ]);
    const h = makeHarness({ llm });
    const { loop, context } = buildEngine(h);

    const goal = 'add a CONTRIBUTING.md file with a code of conduct';
    const outcome = await loop.run(makeIntent({ goal, expectedPaths: ['CONTRIBUTING.md', 'src/db/pool.ts'] }));

    expect(outcome.status).toBe('done');
    const drift = findEvent(h, 'reliability.drift_detected');
    expect(drift).toBeDefined();
    expect((drift?.payload as { action: string }).action).toBe('reanchor');
    // The goal is re-pinned so the next model call is re-anchored.
    expect(context.protectedSlots.goal).toBe(goal);
    expect(metric(h, 'drift.score')).toBeDefined();
  });

  it('does not flag a step that stays on goal', async () => {
    const llm = new ScriptedLLM([
      planTurn([{ title: 'Write CONTRIBUTING.md', acceptance: [fileExists('CONTRIBUTING.md')] }]),
      writeTurn('CONTRIBUTING.md', 'code of conduct'),
      { text: 'wrote the contributing guide and code of conduct' },
    ]);
    const h = makeHarness({ llm });
    const { loop } = buildEngine(h);

    await loop.run(makeIntent({ goal: 'add a CONTRIBUTING.md file with a code of conduct', expectedPaths: ['CONTRIBUTING.md'] }));

    expect(eventTypes(h)).not.toContain('reliability.drift_detected');
  });
});

// ---------------------------------------------------------------------------
// §4.4 — infinite loop
// ---------------------------------------------------------------------------

describe('Phase 2 — loop injection', () => {
  it('breaks a step that repeats the identical action and never hangs', async () => {
    // The model asks for the exact same read forever. The loop detector must cut
    // it off at the threshold, not let it run to the iteration cap.
    const llm = new ScriptedLLM((_request, callIndex) =>
      callIndex === 0 ? planTurn([{ title: 'Read forever', acceptance: [manual()] }]) : readTurn('a.txt'),
    );
    const h = makeHarness({ llm, seed: { [`${WS}/a.txt`]: 'hello' }, config: { loopRepeatThreshold: 3 } });
    const { loop } = buildEngine(h);

    const outcome = await loop.run(makeIntent({ goal: 'read a.txt', expectedPaths: ['a.txt'] }));

    const detected = findEvent(h, 'reliability.loop_detected');
    expect(detected).toBeDefined();
    expect((detected?.payload as { action: string }).action).toBe('break-step');
    // plan + exactly three reads: the third repeat trips the detector and the step
    // is broken without another model call.
    expect(llm.requests.length).toBe(4);
    expect(outcome.status).toBe('done');
  });
});

// ---------------------------------------------------------------------------
// §4.5 — context overflow
// ---------------------------------------------------------------------------

describe('Phase 2 — context-compaction injection', () => {
  it('compacts a swollen context without dropping protected facts', async () => {
    const shell = new FakeShell(() => ({ code: 0, stdout: 'X'.repeat(4_000) }));
    const bulk = (offset: number) => ({
      text: 'Y'.repeat(1_200),
      toolCalls: Array.from({ length: 4 }, (_value, n) => ({
        name: 'shell.exec',
        arguments: { command: `echo job-${offset + n}` },
      })),
    });
    const llm = new ScriptedLLM([
      planTurn([{ title: 'Run jobs', acceptance: [commandExitZero('echo ok')] }]),
      bulk(0),
      bulk(4),
      { text: 'ran the jobs' },
    ]);
    const h = makeHarness({ llm, shell, config: { contextWindow: 800, softLimitRatio: 0.4 } });
    const { loop, context } = buildEngine(h);

    const outcome = await loop.run(makeIntent({ goal: 'run the batch jobs', expectedPaths: [] }));

    expect(outcome.status).toBe('done');
    const compacted = findEvent(h, 'context.compacted');
    expect(compacted).toBeDefined();
    expect((compacted?.payload as { protectedSlots: string[] }).protectedSlots).toContain('goal');
    // Metric M5: nothing protected was lost.
    expect(context.protectedSlotRetention()).toBe(1);
    // Metric M10: the context actually shrank.
    const ratio = metric(h, 'ctx.compaction_ratio');
    expect(ratio).toBeDefined();
    expect(ratio!.value).toBeLessThan(1);
  });
});

// ---------------------------------------------------------------------------
// §4.3 / §3.11 — tool and model failures
// ---------------------------------------------------------------------------

describe('Phase 2 — failure-recovery injection', () => {
  it('retries a transient model failure instead of aborting the task', async () => {
    const llm = new ScriptedLLM([
      planTurn([{ title: 'Write a.txt', acceptance: [fileExists('a.txt')] }]),
      { error: '429 rate limit exceeded' },
      writeTurn('a.txt', 'hello'),
      { text: 'wrote a.txt' },
    ]);
    const h = makeHarness({ llm, config: { maxRetries: 3 } });
    const { loop } = buildEngine(h);

    const outcome = await loop.run(makeIntent({ goal: 'create a.txt', expectedPaths: ['a.txt'] }));

    expect(outcome.status).toBe('done');
    expect(h.fs.files.get(`${WS}/a.txt`)).toBe('hello');
    // plan + the failed attempt + the retry + the finish — the retry is visible.
    expect(llm.requests.length).toBe(4);
    expect(metric(h, 'model.errors')).toBeDefined();
  });

  it('recovers from a missing-file tool error by correcting the approach', async () => {
    const llm = new ScriptedLLM([
      planTurn([{ title: 'Ensure a.txt', acceptance: [fileExists('a.txt')] }]),
      readTurn('a.txt'),
      writeTurn('a.txt', 'hello'),
      { text: 'wrote a.txt' },
    ]);
    const h = makeHarness({ llm });
    const { loop } = buildEngine(h);

    const outcome = await loop.run(makeIntent({ goal: 'ensure a.txt exists', expectedPaths: ['a.txt'] }));

    expect(outcome.status).toBe('done');
    expect(h.fs.files.get(`${WS}/a.txt`)).toBe('hello');
    const types = eventTypes(h);
    expect(types).toContain('tool.failed');
    expect(types).toContain('tool.finished');
    expect(outcome.verdicts.at(-1)?.status).toBe('pass');
  });

  it('recovers from a non-zero command exit by retrying the step until it passes', async () => {
    // The acceptance command fails on its first run and passes on the second. The
    // failure classifies as a tool error, so the step is re-executed rather than
    // escalated — this is metric M11's "tool failure self-recovers" path.
    let runs = 0;
    const shell = new FakeShell(() => ({ code: (runs += 1) === 1 ? 1 : 0, stdout: 'ok' }));
    const llm = new ScriptedLLM([
      planTurn([{ title: 'Make the check pass', acceptance: [commandExitZero('node check.mjs')] }]),
      writeTurn('a.txt', 'v1'),
      { text: 'wrote v1' },
      writeTurn('a.txt', 'v2'),
      { text: 'wrote v2' },
    ]);
    const h = makeHarness({ llm, shell });
    const { loop } = buildEngine(h);

    const outcome = await loop.run(makeIntent({ goal: 'make the check pass', expectedPaths: ['a.txt'] }));

    expect(outcome.status).toBe('done');
    expect(outcome.verdicts.at(-1)?.status).toBe('pass');
    expect(eventTypes(h)).toContain('recovery.attempted');
    // The verifier ran the command twice: once failing, once passing.
    expect(shell.commands.map((c) => c.command)).toEqual(['node check.mjs', 'node check.mjs']);
  });

  it('bounds a hung tool with a timeout and keeps the run alive', async () => {
    const hangingTool = {
      name: 'hang.forever',
      description: 'never resolves — used to prove the per-tool timeout',
      schema: { type: 'object', properties: {}, additionalProperties: false },
      risk: 'read-only' as const,
      reversible: false,
      run: () => new Promise<never>(() => {}),
    };
    const llm = new ScriptedLLM([
      planTurn([{ title: 'Hang on a tool', acceptance: [manual()] }]),
      { toolCalls: [{ name: 'hang.forever', arguments: {} }] },
      { text: 'abandoned the hung tool' },
    ]);
    const h = makeHarness({ llm, config: { toolTimeoutMs: 20 } });
    const { loop } = buildEngine(h, { extraTools: [hangingTool] });

    const outcome = await loop.run(makeIntent({ goal: 'try the hung tool', expectedPaths: [] }));

    const failed = findEvent(h, 'tool.failed');
    expect(failed).toBeDefined();
    expect((failed?.payload as { error: string }).error).toMatch(/timed out/);
    expect((failed?.payload as { recoverable: boolean }).recoverable).toBe(true);
    expect(outcome.status).toBe('done');
  });
});

// ---------------------------------------------------------------------------
// §4.7 — intervention: changing the goal mid-flight
// ---------------------------------------------------------------------------

describe('Phase 2 — intervention injection', () => {
  it('applies a mid-task goal change and completes under the new goal', async () => {
    const llm = new ScriptedLLM([
      planTurn([
        { title: 'Write a.txt', acceptance: [fileExists('a.txt')] },
        { title: 'Write b.txt', deps: [0], acceptance: [fileExists('b.txt')] },
      ]),
      writeTurn('a.txt', 'A'),
      { text: 'wrote a.txt' },
      writeTurn('b.txt', 'B'),
      { text: 'wrote b.txt' },
    ]);
    const h = makeHarness({ llm });
    const { loop, context } = buildEngine(h);

    let seen = 0;
    h.bus.on('step.completed', () => {
      seen += 1;
      if (seen === 1) loop.intervene('also add a CHANGELOG entry');
    });

    const outcome = await loop.run(makeIntent({ goal: 'write two files', expectedPaths: ['a.txt', 'b.txt'] }));

    expect(outcome.status).toBe('done');
    expect(eventTypes(h)).toContain('task.intervened');
    // The new goal becomes the protected slot, so the next model call is re-anchored.
    expect(context.protectedSlots.goal).toBe('also add a CHANGELOG entry');
  });

  it('preserves work finished before the intervention', async () => {
    const llm = new ScriptedLLM([
      planTurn([
        { title: 'Write a.txt', acceptance: [fileExists('a.txt')] },
        { title: 'Write b.txt', deps: [0], acceptance: [fileExists('b.txt')] },
      ]),
      writeTurn('a.txt', 'keep me'),
      { text: 'wrote a.txt' },
      writeTurn('b.txt', 'B'),
      { text: 'wrote b.txt' },
    ]);
    const h = makeHarness({ llm });
    const { loop } = buildEngine(h);

    let seen = 0;
    h.bus.on('step.completed', () => {
      seen += 1;
      if (seen === 1) loop.intervene('focus the rest of the work on b.txt');
    });

    const outcome = await loop.run(makeIntent({ goal: 'write two files', expectedPaths: ['a.txt', 'b.txt'] }));

    expect(outcome.status).toBe('done');
    // Step 0's output survives the goal change; the intervention redirects the
    // remaining work rather than discarding what is already done.
    expect(h.fs.files.get(`${WS}/a.txt`)).toBe('keep me');
    expect(h.fs.files.get(`${WS}/b.txt`)).toBe('B');
  });
});

// ---------------------------------------------------------------------------
// §4.7 — interruption and resume
// ---------------------------------------------------------------------------

describe('Phase 2 — interruption and resume', () => {
  it('resumes a persisted plan in a fresh engine instance after a restart', async () => {
    const llm = new ScriptedLLM([
      planTurn([
        { title: 'Write a.txt', acceptance: [fileExists('a.txt')] },
        { title: 'Write b.txt', deps: [0], acceptance: [fileExists('b.txt')] },
      ]),
      writeTurn('a.txt', 'A'),
      { text: 'wrote a.txt' },
      writeTurn('b.txt', 'B'),
      { text: 'wrote b.txt' },
    ]);
    const h = makeHarness({ llm });

    // The production composition root creates the task row before the loop runs;
    // the harness helper does not, so seed it here to model a real persisted task.
    h.store.tasks.set(h.ctx.taskId, {
      id: h.ctx.taskId,
      sessionId: h.ctx.sessionId,
      intentRaw: 'write two files',
      status: 'received',
      phase: 'idle',
      progress: 0,
      createdAt: 0,
      updatedAt: 0,
    });

    // First engine: pause after step 0, as if the process died mid-task.
    const first = buildEngine(h);
    let seen = 0;
    h.bus.on('step.completed', () => {
      seen += 1;
      if (seen === 1) first.loop.pause('simulated crash');
    });
    const paused = await first.loop.run(makeIntent({ goal: 'write two files', expectedPaths: ['a.txt', 'b.txt'] }));

    expect(paused.status).toBe('paused');
    expect(h.fs.files.has(`${WS}/b.txt`)).toBe(false);

    // The plan survived in the store; a *new* engine resumes from it.
    const task = await h.store.getTask(h.ctx.taskId);
    expect(task?.plan).toBeDefined();

    const second = buildEngine(h);
    const resumed = await second.loop.run(makeIntent({ goal: 'write two files', expectedPaths: ['a.txt', 'b.txt'] }), {
      plan: task!.plan,
      startStepIdx: 1,
    });

    expect(resumed.status).toBe('done');
    expect(h.fs.files.get(`${WS}/b.txt`)).toBe('B');
    // plan + write a + finish + (resume) write b + finish
    expect(llm.requests.length).toBe(5);
  });
});
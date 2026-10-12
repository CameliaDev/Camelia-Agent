/**
 * AgentLoop integration tests (whitepaper §3.1, §4).
 *
 * These drive the *whole* engine — planner, executor, verifier, recovery,
 * context, journal, sub-agents — over fakes, so what is asserted is the lifecycle
 * behaviour a task actually experiences: pause/resume, cancellation, goal
 * intervention, replan escalation, rollback and progress projection.
 * @module
 */

import { describe, expect, it } from 'vitest';

import type { Plan } from '@camelia/core';

import { PlanGate } from '../src/planning/PlanGate.js';
import { FakeShell, ScriptedLLM, acceptancePoint, makeHarness, makeIntent, type Harness } from './helpers/context.js';
import { buildEngine } from './helpers/engine.js';

const WS = 'C:/workspace';

// ---------------------------------------------------------------------------
// scripted-plan builders
// ---------------------------------------------------------------------------

interface RawStepSpec {
  title: string;
  goal?: string;
  deps?: number[];
  acceptance: { kind: string; params: Record<string, unknown>; description?: string }[];
}

/** A planner turn: JSON-only plan body, exactly as the prompt requests. */
function planTurn(steps: RawStepSpec[]): { text: string } {
  return { text: JSON.stringify({ steps }) };
}

function writeTurn(path: string, content: string) {
  return { toolCalls: [{ name: 'fs.write', arguments: { path, content } }] };
}

const finishTurn = { text: 'wrote the file' };

function fileExists(path: string): RawStepSpec['acceptance'][number] {
  return { kind: 'file-exists', params: { path }, description: `${path} exists` };
}

function fileContains(path: string, pattern: string): RawStepSpec['acceptance'][number] {
  return { kind: 'file-contains', params: { path, pattern }, description: `${path} matches ${pattern}` };
}

function commandExitZero(command: string): RawStepSpec['acceptance'][number] {
  return { kind: 'command-exit-zero', params: { command }, description: `${command} exits 0` };
}

function eventTypes(h: Harness): string[] {
  return h.events.map((e) => e.type);
}

// ---------------------------------------------------------------------------
// happy paths
// ---------------------------------------------------------------------------

describe('AgentLoop — completion', () => {
  it('completes a single-step task and verifies it objectively', async () => {
    const llm = new ScriptedLLM([
      planTurn([{ title: 'Write a.txt', acceptance: [fileExists('a.txt')] }]),
      writeTurn('a.txt', 'hello'),
      finishTurn,
    ]);
    const h = makeHarness({ llm });
    const { loop } = buildEngine(h);

    const outcome = await loop.run(makeIntent({ goal: 'create a.txt', expectedPaths: ['a.txt'] }));

    expect(outcome.status).toBe('done');
    expect(outcome.stepsCompleted).toBe(1);
    expect(outcome.stepsTotal).toBe(1);
    expect(outcome.unverifiedSteps).toBe(0);
    expect(h.fs.files.get(`${WS}/a.txt`)).toBe('hello');
    expect(outcome.verdicts.every((v) => v.status === 'pass')).toBe(true);
    expect(outcome.artifacts.map((a) => a.path)).toContain('a.txt');
  });

  it('runs multiple dependent steps in topological order', async () => {
    const llm = new ScriptedLLM([
      planTurn([
        { title: 'Write a.txt', acceptance: [fileExists('a.txt')] },
        { title: 'Write b.txt', deps: [0], acceptance: [fileExists('b.txt')] },
      ]),
      writeTurn('a.txt', 'A'),
      finishTurn,
      writeTurn('b.txt', 'B'),
      finishTurn,
    ]);
    const h = makeHarness({ llm });
    const { loop } = buildEngine(h);

    const outcome = await loop.run(makeIntent({ goal: 'create two files', expectedPaths: ['a.txt', 'b.txt'] }));

    expect(outcome.status).toBe('done');
    expect(outcome.stepsCompleted).toBe(2);
    expect(h.fs.files.get(`${WS}/a.txt`)).toBe('A');
    expect(h.fs.files.get(`${WS}/b.txt`)).toBe('B');

    // Progress is projected as the task advances, not only at the end.
    const progress = h.events.filter((e) => e.type === 'task.progress');
    expect(progress.length).toBeGreaterThanOrEqual(3);
    const final = progress.at(-1)?.payload as { progress: number };
    expect(final.progress).toBe(1);
  });

  it('emits the full observable lifecycle so a UI can project every phase', async () => {
    const llm = new ScriptedLLM([
      planTurn([{ title: 'Write a.txt', acceptance: [fileExists('a.txt')] }]),
      writeTurn('a.txt', 'hi'),
      finishTurn,
    ]);
    const h = makeHarness({ llm });
    const { loop } = buildEngine(h);

    await loop.run(makeIntent({ goal: 'create a.txt', expectedPaths: ['a.txt'] }));

    const types = eventTypes(h);
    for (const required of [
      'task.status_changed',
      'task.phase_changed',
      'plan.ready',
      'checkpoint.created',
      'step.started',
      'tool.requested',
      'tool.approved',
      'tool.finished',
      'step.completed',
      'verify.result',
      'task.progress',
      'task.completed',
      'memory.written',
    ]) {
      expect(types, `missing event ${required}`).toContain(required);
    }
  });
});

// ---------------------------------------------------------------------------
// recovery: fixup retry, replan, rollback
// ---------------------------------------------------------------------------

describe('AgentLoop — recovery', () => {
  it('re-runs a step whose verification failed with a retryable reason', async () => {
    // First verification run exits 1, the fixup run exits 0 — the tool failure
    // class is retryable, so the loop re-executes the step instead of escalating.
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

    const outcome = await loop.run(makeIntent({ goal: 'make check pass', expectedPaths: ['a.txt'] }));

    expect(outcome.status).toBe('done');
    expect(outcome.verdicts.at(-1)?.status).toBe('pass');
    expect(h.fs.files.get(`${WS}/a.txt`)).toBe('v2');
    expect(eventTypes(h)).toContain('recovery.attempted');
  });

  it('shows live step status in open-todos and keeps completed steps on a retry', async () => {
    let calls = 0;
    const shell = new FakeShell(() => ({ code: (calls += 1) === 1 ? 1 : 0, stdout: 'ok' }));
    const llm = new ScriptedLLM([
      planTurn([
        { title: 'Write a.txt', acceptance: [fileExists('a.txt')] },
        { title: 'Run check', acceptance: [commandExitZero('node check.mjs')] },
      ]),
      writeTurn('a.txt', 'A'),
      finishTurn,
      finishTurn,
      finishTurn,
    ]);
    const h = makeHarness({ llm, shell });
    const { loop } = buildEngine(h);

    const outcome = await loop.run(makeIntent({ goal: 'write a.txt then check', expectedPaths: ['a.txt'] }));

    expect(outcome.status).toBe('done');
    expect(outcome.stepsCompleted).toBe(2);
    const systems = llm.requests.map(
      (request) => request.messages.find((message) => message.role === 'system')?.content ?? '',
    );
    const step1 = systems.find((text) => text.includes('Step 1/2: Write a.txt'));
    const step2 = systems.find((text) => text.includes('Step 2/2: Run check'));
    const fixup = systems.find((text) => text.includes('FAILED verification') && text.includes('Run check'));
    expect(step1).toContain('[running] Write a.txt');
    expect(step1).toContain('[pending] Run check');
    expect(step1).not.toContain('[pending] Write a.txt');
    expect(step2).toContain('[done] Write a.txt');
    expect(step2).toContain('[running] Run check');
    expect(step2).not.toContain('[pending] Write a.txt');
    expect(step2).toContain('Completed so far:');
    expect(fixup).toContain('[done] Write a.txt');
    expect(fixup).toContain('[running] Run check');
    expect(fixup).toContain('Completed so far:');
    expect(fixup).toContain('Write a.txt');
  });

  it('escalates to replan after a verification failure and finishes with the revised plan', async () => {
    const llm = new ScriptedLLM([
      // Plan v1 fails: the content never contains MAGIC.
      planTurn([{ title: 'Write with magic', acceptance: [fileContains('a.txt', 'MAGIC')] }]),
      writeTurn('a.txt', 'hello'),
      finishTurn,
      // Revised plan is verifiable and succeeds.
      planTurn([{ title: 'Write a.txt', acceptance: [fileExists('a.txt')] }]),
      writeTurn('a.txt', 'hello'),
      finishTurn,
    ]);
    const h = makeHarness({ llm });
    const { loop } = buildEngine(h);

    const outcome = await loop.run(makeIntent({ goal: 'write a.txt', expectedPaths: ['a.txt'] }));

    expect(outcome.status).toBe('done');
    expect(eventTypes(h)).toContain('plan.revised');
    expect(outcome.verdicts.at(-1)?.status).toBe('pass');
  });

  it('rolls the workspace back and fails when the revised plan also fails', async () => {
    const llm = new ScriptedLLM([
      planTurn([{ title: 'Write with magic', acceptance: [fileContains('a.txt', 'MAGIC')] }]),
      writeTurn('a.txt', 'hello'),
      finishTurn,
      // Revised plan still fails.
      planTurn([{ title: 'Write with other magic', acceptance: [fileContains('a.txt', 'MAGIC2')] }]),
      writeTurn('a.txt', 'hello'),
      finishTurn,
    ]);
    const h = makeHarness({ llm });
    const { loop } = buildEngine(h);

    const outcome = await loop.run(makeIntent({ goal: 'write a.txt', expectedPaths: ['a.txt'] }));

    expect(outcome.status).toBe('failed');
    expect(outcome.reason).toMatch(/failed/i);
    // The new file the task created must not survive a failed run (metric M6).
    expect(h.fs.files.has(`${WS}/a.txt`)).toBe(false);
    const types = eventTypes(h);
    expect(types).toContain('recovery.rollback_started');
    expect(types).toContain('recovery.rollback_done');
    expect(types).toContain('task.failed');
  });

  it('restores a pre-existing file to its original bytes on rollback', async () => {
    const llm = new ScriptedLLM([
      planTurn([{ title: 'Break config', acceptance: [fileContains('config.json', 'MAGIC')] }]),
      writeTurn('config.json', 'CORRUPTED'),
      finishTurn,
      // Revised plan also fails.
      planTurn([{ title: 'Break config again', acceptance: [fileContains('config.json', 'MAGIC2')] }]),
      writeTurn('config.json', 'CORRUPTED2'),
      finishTurn,
    ]);
    const h = makeHarness({ llm, seed: { [`${WS}/config.json`]: 'ORIGINAL' } });
    const { loop } = buildEngine(h);

    const outcome = await loop.run(makeIntent({ goal: 'update config', expectedPaths: ['config.json'] }));

    expect(outcome.status).toBe('failed');
    expect(h.fs.files.get(`${WS}/config.json`)).toBe('ORIGINAL');
  });
});

// ---------------------------------------------------------------------------
// pause / cancel / intervene
// ---------------------------------------------------------------------------

describe('AgentLoop — control', () => {
  it('pauses at a step boundary and reports where a resume would continue', async () => {
    const llm = new ScriptedLLM([
      planTurn([
        { title: 'Write a.txt', acceptance: [fileExists('a.txt')] },
        { title: 'Write b.txt', deps: [0], acceptance: [fileExists('b.txt')] },
      ]),
      writeTurn('a.txt', 'A'),
      finishTurn,
      writeTurn('b.txt', 'B'),
      finishTurn,
    ]);
    const h = makeHarness({ llm });
    const { loop } = buildEngine(h);

    let seen = 0;
    h.bus.on('step.completed', () => {
      seen += 1;
      if (seen === 1) loop.pause('user hit pause');
    });

    const outcome = await loop.run(makeIntent({ goal: 'two files', expectedPaths: ['a.txt', 'b.txt'] }));

    expect(outcome.status).toBe('paused');
    expect(outcome.stepsCompleted).toBe(1);
    expect(outcome.resumeStepIdx).toBe(1);
    expect(h.fs.files.has(`${WS}/b.txt`)).toBe(false);
    expect(eventTypes(h)).toContain('task.paused');
  });

  it('cancels mid-run and reports the cancellation reason', async () => {
    const llm = new ScriptedLLM([
      planTurn([
        { title: 'Write a.txt', acceptance: [fileExists('a.txt')] },
        { title: 'Write b.txt', deps: [0], acceptance: [fileExists('b.txt')] },
      ]),
      writeTurn('a.txt', 'A'),
      finishTurn,
      writeTurn('b.txt', 'B'),
      finishTurn,
    ]);
    const h = makeHarness({ llm });
    const { loop } = buildEngine(h);

    let seen = 0;
    h.bus.on('step.completed', () => {
      seen += 1;
      if (seen === 1) loop.cancel('user cancelled');
    });

    const outcome = await loop.run(makeIntent({ goal: 'two files', expectedPaths: ['a.txt', 'b.txt'] }));

    expect(outcome.status).toBe('cancelled');
    expect(outcome.reason).toBe('user cancelled');
    expect(h.fs.files.has(`${WS}/b.txt`)).toBe(false);
    expect(eventTypes(h)).toContain('task.cancelled');
  });

  it('re-anchors to a new goal when the user intervenes mid-task', async () => {
    const llm = new ScriptedLLM([
      planTurn([
        { title: 'Write a.txt', acceptance: [fileExists('a.txt')] },
        { title: 'Write b.txt', deps: [0], acceptance: [fileExists('b.txt')] },
      ]),
      writeTurn('a.txt', 'A'),
      finishTurn,
      writeTurn('b.txt', 'B'),
      finishTurn,
    ]);
    const h = makeHarness({ llm });
    const { loop, context } = buildEngine(h);

    let seen = 0;
    h.bus.on('step.completed', () => {
      seen += 1;
      if (seen === 1) loop.intervene('also write a README');
    });

    const outcome = await loop.run(makeIntent({ goal: 'two files', expectedPaths: ['a.txt', 'b.txt'] }));

    expect(outcome.status).toBe('done');
    const intervened = h.events.find((e) => e.type === 'task.intervened');
    expect(intervened).toBeDefined();
    expect((intervened?.payload as { newGoal: string }).newGoal).toBe('also write a README');
    // The protected goal slot is updated so the next model call is re-anchored.
    expect(context.protectedSlots.goal).toBe('also write a README');
  });
});

// ---------------------------------------------------------------------------
// verification edge cases
// ---------------------------------------------------------------------------

describe('AgentLoop — verification edges', () => {
  it('counts an unverifiable step as unverified rather than silently passing it', async () => {
    const llm = new ScriptedLLM([
      planTurn([{ title: 'Think about it', acceptance: [{ kind: 'manual', params: {}, description: 'human judgement' }] }]),
      finishTurn,
    ]);
    const h = makeHarness({ llm });
    const { loop } = buildEngine(h);

    const outcome = await loop.run(makeIntent({ goal: 'think', expectedPaths: [] }));

    expect(outcome.status).toBe('done');
    expect(outcome.unverifiedSteps).toBe(1);
    expect(outcome.summary).toMatch(/could not be objectively verified/);
  });

  it('fails fast when an acceptance path escapes the workspace', async () => {
    const llm = new ScriptedLLM([
      planTurn([{ title: 'Escape', acceptance: [fileExists('../escaped.txt')] }]),
      finishTurn,
    ]);
    const h = makeHarness({ llm });
    const { loop } = buildEngine(h);

    const outcome = await loop.run(makeIntent({ goal: 'escape', expectedPaths: [] }));

    expect(outcome.status).toBe('failed');
    expect(outcome.summary ?? outcome.reason ?? '').toMatch(/escaped\.txt|Rejected path/);
  });

  it('re-anchors the goal after a no-progress streak', async () => {
    const llm = new ScriptedLLM([
      planTurn([
        { title: 's1', acceptance: [{ kind: 'manual', params: {}, description: 'm' }] },
        { title: 's2', deps: [0], acceptance: [{ kind: 'manual', params: {}, description: 'm' }] },
        { title: 's3', deps: [1], acceptance: [{ kind: 'manual', params: {}, description: 'm' }] },
      ]),
      finishTurn,
      finishTurn,
      finishTurn,
    ]);
    const h = makeHarness({ llm, config: { noProgressThreshold: 2 } });
    const { loop } = buildEngine(h);

    await loop.run(makeIntent({ goal: 'stall out', expectedPaths: [] }));

    expect(eventTypes(h)).toContain('reliability.no_progress');
  });
});

// ---------------------------------------------------------------------------
// resume path
// ---------------------------------------------------------------------------

describe('AgentLoop — resume', () => {
  it('resumes a persisted plan and skips already-completed steps', async () => {
    // Simulate a resume: the plan is supplied and step 0 is already done.
    const plan: Plan = {
      id: 'p1',
      taskId: 't1',
      mode: 'fast',
      revision: 0,
      createdAt: 0,
      steps: [
        {
          id: 's1',
          taskId: 't1',
          idx: 0,
          title: 'already done',
          goal: 'g',
          status: 'done',
          acceptance: [],
          weight: 1,
          deps: [],
        },
        {
          id: 's2',
          taskId: 't1',
          idx: 1,
          title: 'Write b.txt',
          goal: 'g',
          status: 'pending',
          acceptance: [acceptancePoint('file-exists', { path: 'b.txt' })],
          weight: 1,
          deps: ['s1'],
        },
      ],
    };
    const llm = new ScriptedLLM([writeTurn('b.txt', 'B'), finishTurn]);
    const h = makeHarness({ llm });
    const { loop } = buildEngine(h);

    const outcome = await loop.run(makeIntent({ goal: 'finish the job', expectedPaths: ['b.txt'] }), { plan });

    expect(outcome.status).toBe('done');
    expect(outcome.stepsCompleted).toBe(2);
    expect(h.fs.files.get(`${WS}/b.txt`)).toBe('B');
    // Only the pending step hit the model.
    expect(llm.requests.length).toBe(2);
  });

  it('rolls back the public rollback() to a checkpoint', async () => {
    const llm = new ScriptedLLM([planTurn([{ title: 'Write a.txt', acceptance: [fileExists('a.txt')] }]), writeTurn('a.txt', 'x'), finishTurn]);
    const h = makeHarness({ llm });
    const { loop, journal } = buildEngine(h);

    await loop.run(makeIntent({ goal: 'write', expectedPaths: ['a.txt'] }));
    expect(h.fs.files.has(`${WS}/a.txt`)).toBe(true);

    const restored = await loop.rollback('anything');
    expect(restored).toBe(1);
    expect(h.fs.files.has(`${WS}/a.txt`)).toBe(false);
    expect(journal.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Iteration 21: memory outcome feedback — hit → validate → strengthen/downgrade
// ---------------------------------------------------------------------------

function seedRecipe(h: Harness, id: string, correctness: number): void {
  h.store.memories.push({
    id,
    scope: 'global',
    kind: 'procedural',
    content: 'When asked to "create the todo module", a working approach is: Write todo.ts → Verify.',
    keywords: 'create todo module',
    importance: 0.6,
    retrievable: false,
    correctness,
    layer: 'procedural',
    createdAt: 0,
    updatedAt: 0,
  });
}

describe('AgentLoop — memory outcome feedback loop (Iteration 21)', () => {
  it('recalls a procedural recipe, injects it, and strengthens it when the task fully verifies', async () => {
    const llm = new ScriptedLLM([
      planTurn([{ title: 'Write a.txt', acceptance: [fileExists('a.txt')] }]),
      writeTurn('a.txt', 'hello'),
      finishTurn,
    ]);
    const h = makeHarness({ llm });
    seedRecipe(h, 'rec-hit', 0.5);
    const { loop } = buildEngine(h);

    const outcome = await loop.run(makeIntent({ goal: 'create the todo module', expectedPaths: ['a.txt'] }));

    expect(outcome.status).toBe('done');
    expect(outcome.unverifiedSteps).toBe(0);

    // The recipe was injected into the model context (hit → used).
    const lastRequest = llm.requests.at(-1)!;
    const contextText = lastRequest.messages.map((m) => String(m.content)).join('\n');
    expect(contextText).toContain('<remembered-context>');
    expect(contextText).toContain('working approach');

    // The recall event carried provenance: which memory, which layer.
    const recalled = h.events.find((e) => e.type === 'memory.recalled');
    expect(recalled).toBeTruthy();
    const recalledPayload = recalled!.payload as { provenance: { memoryId: string; layer: string; matchedBy: string }[] };
    const entry = recalledPayload.provenance.find((p) => p.memoryId === 'rec-hit');
    expect(entry).toBeTruthy();
    expect(entry!.layer).toBe('procedural');
    expect(entry!.matchedBy.length).toBeGreaterThan(0);

    // Verified outcome → correctness raised to 1; nothing was downgraded.
    const stored = h.store.memories.find((m) => m.id === 'rec-hit')!;
    expect(stored.correctness).toBe(1);
    expect(h.events.some((e) => e.type === 'memory.downgraded')).toBe(false);
  });

  it('downgrades an injected procedural recipe when the task fails verification', async () => {
    // Same script as the rollback test: plan v1 fails, revised plan v2 fails.
    const llm = new ScriptedLLM([
      planTurn([{ title: 'Write with magic', acceptance: [fileContains('a.txt', 'MAGIC')] }]),
      writeTurn('a.txt', 'hello'),
      finishTurn,
      planTurn([{ title: 'Write with other magic', acceptance: [fileContains('a.txt', 'MAGIC2')] }]),
      writeTurn('a.txt', 'hello'),
      finishTurn,
    ]);
    const h = makeHarness({ llm });
    seedRecipe(h, 'rec-miss', 0.5);
    const { loop } = buildEngine(h);

    const outcome = await loop.run(makeIntent({ goal: 'create the todo module', expectedPaths: ['a.txt'] }));

    expect(outcome.status).toBe('failed');

    // Disproved outcome → correctness 0, strength 0; the item stays stored as an
    // auditable negative fact but will no longer be recalled (correction channel).
    const stored = h.store.memories.find((m) => m.id === 'rec-miss')!;
    expect(stored.correctness).toBe(0);
    expect(stored.strength).toBe(0);
    const downgraded = h.events.find((e) => e.type === 'memory.downgraded');
    expect(downgraded).toBeTruthy();
    const payload = downgraded!.payload as { memoryId: string; reason: string };
    expect(payload.memoryId).toBe('rec-miss');
    expect(payload.reason).toBe('task-verification-gap');
  });

  it('promotes important short-term memories to long-term at reflection (session end)', async () => {
    const llm = new ScriptedLLM([
      planTurn([{ title: 'Write a.txt', acceptance: [fileExists('a.txt')] }]),
      writeTurn('a.txt', 'hello'),
      finishTurn,
    ]);
    const h = makeHarness({ llm });
    h.store.memories.push({
      id: 'rec-promote',
      scope: 'session',
      sessionId: h.ctx.sessionId,
      kind: 'fact',
      content: 'the staging key lives in the vault',
      keywords: 'staging vault',
      importance: 0.8,
      layer: 'short',
      createdAt: 0,
      updatedAt: 0,
    });
    const { loop } = buildEngine(h);

    await loop.run(makeIntent({ goal: 'create a.txt', expectedPaths: ['a.txt'] }));

    const promoted = h.store.memories.find((m) => m.id === 'rec-promote')!;
    expect(promoted.layer).toBe('long');
    expect(promoted.scope).toBe('global');
  });
});

async function untilStatus(h: Harness, status: string): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    const hit = h.events.some(
      (event) => event.type === 'task.status_changed' && (event.payload as { to?: string }).to === status,
    );
    if (hit) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`never reached ${status}`);
}

describe('AgentLoop — plan gate', () => {
  it('waits in awaiting-approval until the plan is approved once', async () => {
    const llm = new ScriptedLLM([
      planTurn([{ title: 'Write a.txt', acceptance: [fileExists('a.txt')] }]),
      writeTurn('a.txt', 'hello'),
      finishTurn,
    ]);
    const h = makeHarness({ llm });
    h.ctx.config.planApproval = 'always';
    const gate = new PlanGate();
    const { loop } = buildEngine(h, { planGate: gate });
    const pending = loop.run(makeIntent({ goal: 'create a.txt', expectedPaths: ['a.txt'] }));
    await untilStatus(h, 'awaiting-approval');
    expect(gate.settleOnly({ action: 'approve', scope: 'once' })).toBe(true);
    const outcome = await pending;
    expect(outcome.status).toBe('done');
  });

  it('skips the wait after a session-scoped approval has been armed', async () => {
    const llm = new ScriptedLLM([
      planTurn([{ title: 'Write a.txt', acceptance: [fileExists('a.txt')] }]),
      writeTurn('a.txt', 'hello'),
      finishTurn,
    ]);
    const h = makeHarness({ llm });
    h.ctx.config.planApproval = 'always';
    const gate = new PlanGate();
    gate.armSession();
    const { loop } = buildEngine(h, { planGate: gate });
    const outcome = await loop.run(makeIntent({ goal: 'create a.txt', expectedPaths: ['a.txt'] }));
    expect(outcome.status).toBe('done');
    expect(h.events.some((event) => event.type === 'task.status_changed' && (event.payload as { to?: string }).to === 'executing')).toBe(true);
  });
});
/**
 * Projection tests (whitepaper §6.1–§6.3).
 *
 * The UI is a projection of task state, so the projection is the thing that must be
 * provably correct: these tests fold real domain events and assert what the user
 * would see — phase, step statuses, tool input/output/duration, context usage,
 * compaction log, sub-agents, failures and approvals.
 * @module
 */

import { describe, expect, it } from 'vitest';

import type {
  AcceptancePoint,
  Checkpoint,
  DomainEvent,
  DomainEventMap,
  DomainEventOf,
  DomainEventType,
  Plan,
  Step,
  SubAgentReport,
  Task,
  TaskStatus,
  ToolCall,
  Verdict,
} from '@camelia/core';

import {
  applyEvent,
  computeProgress,
  contextUsage,
  initialSnapshot,
  reduceEvents,
  toProviderStatus,
  withProviderStatus,
  withSession,
  type ProjectionSnapshot,
} from '../src/view/index.js';

// ---------------------------------------------------------------------------
// builders
// ---------------------------------------------------------------------------

function env<T extends DomainEventType>(type: T, payload: DomainEventMap[T], ts: number): DomainEventOf<T> {
  return { type, payload, traceId: `trace-${ts}`, ts };
}

const TASK_ID = 'task-1';
const SESSION_ID = 'session-1';

function acceptance(description: string, kind: AcceptancePoint['kind'] = 'file-exists'): AcceptancePoint {
  return { id: `ap-${description}`, description, kind, params: {} };
}

function step(idx: number, title: string, overrides: Partial<Step> = {}): Step {
  return {
    id: `step-${idx}`,
    taskId: TASK_ID,
    idx,
    title,
    goal: `Do ${title}`,
    status: 'pending',
    acceptance: [acceptance(`${title} done`)],
    weight: 1,
    deps: [],
    ...overrides,
  };
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: TASK_ID,
    sessionId: SESSION_ID,
    intentRaw: 'add a CONTRIBUTING.md',
    status: 'received',
    phase: 'idle',
    progress: 0,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function plan(steps: Step[]): Plan {
  return { id: 'plan-1', taskId: TASK_ID, steps, mode: 'full', revision: 1, createdAt: 1 };
}

function toolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    id: 'call-1',
    stepId: 'step-0',
    taskId: TASK_ID,
    name: 'fs.write',
    input: { path: 'a.txt', content: 'hello' },
    status: 'pending',
    risk: 'write',
    reversible: true,
    traceId: 'trace-1',
    createdAt: 2,
    ...overrides,
  };
}

function verdict(overrides: Partial<Verdict> = {}): Verdict {
  return {
    id: 'verdict-1',
    stepId: 'step-0',
    taskId: TASK_ID,
    status: 'pass',
    evidence: [],
    reason: 'a.txt exists',
    createdAt: 3,
    ...overrides,
  };
}

function report(overrides: Partial<SubAgentReport> = {}): SubAgentReport {
  return {
    id: 'sub-1',
    parentTaskId: TASK_ID,
    goal: 'scan the repo',
    status: 'ok',
    summary: 'found 3 modules',
    artifacts: [],
    verdicts: [],
    tokensUsed: 120,
    startedAt: 5,
    endedAt: 6,
    ...overrides,
  };
}

function checkpoint(): Checkpoint {
  return { id: 'cp-1', taskId: TASK_ID, stepIdx: 0, ctxSummary: 'after step 0', fsManifest: { entries: {} }, createdAt: 4 };
}

/** Fold a list of events starting from an empty snapshot. */
function fold(events: DomainEvent[]): ProjectionSnapshot {
  return reduceEvents(initialSnapshot(), events);
}

// ---------------------------------------------------------------------------
// lifecycle
// ---------------------------------------------------------------------------

describe('projection — task lifecycle', () => {
  it('projects a received task', () => {
    const snapshot = fold([env('task.received', { task: task() }, 0)]);

    expect(snapshot.task?.intentRaw).toBe('add a CONTRIBUTING.md');
    expect(snapshot.task?.status).toBe('received');
    expect(snapshot.task?.steps).toEqual([]);
  });

  it('projects a ready plan into ordered steps with a phase', () => {
    const snapshot = fold([
      env('task.received', { task: task() }, 0),
      env('plan.started', { mode: 'full' }, 1),
      env('plan.ready', { plan: plan([step(1, 'second'), step(0, 'first')]) }, 2),
    ]);

    expect(snapshot.task?.phase).toBe('planning');
    expect(snapshot.task?.steps.map((s) => s.title)).toEqual(['first', 'second']);
    expect(snapshot.task?.stepsTotal).toBe(2);
    expect(snapshot.task?.activity.kind).toBe('executing');
  });

  it('tracks step status, verdicts and weighted progress', () => {
    const snapshot = fold([
      env('task.received', { task: task() }, 0),
      env('plan.ready', { plan: plan([step(0, 'first', { weight: 3 }), step(1, 'second', { weight: 1 })]) }, 1),
      env('step.started', { step: step(0, 'first', { weight: 3 }) }, 2),
      env('verify.started', { stepId: 'step-0', points: 1 }, 3),
      env('verify.result', { verdict: verdict() }, 4),
      env('step.completed', { step: step(0, 'first', { weight: 3 }), result: { stepId: 'step-0', status: 'ok', toolCalls: [], summary: '', artifacts: [] }, score: 3 }, 5),
    ]);

    const steps = snapshot.task!.steps;
    expect(steps[0]?.status).toBe('done');
    expect(steps[0]?.verdict?.status).toBe('pass');
    expect(steps[1]?.status).toBe('pending');
    // 3 of 4 weight units done.
    expect(snapshot.task?.progress).toBeCloseTo(0.75);
  });

  it('records a mid-flight goal change without losing prior work', () => {
    const snapshot = fold([
      env('task.received', { task: task() }, 0),
      env('task.clarified', { intent: { goal: 'write two files', assumptions: [], constraints: [], expectedPaths: [], complete: true } }, 1),
      env('task.intervened', { instruction: 'also add a changelog', previousGoal: 'write two files', newGoal: 'also add a changelog' }, 2),
    ]);

    expect(snapshot.task?.goal).toBe('also add a changelog');
    expect(snapshot.task?.interventions).toHaveLength(1);
    expect(snapshot.task?.interventions[0]?.previousGoal).toBe('write two files');
  });

  it('projects completion with artifacts and full progress', () => {
    const snapshot = fold([
      env('task.received', { task: task() }, 0),
      env('plan.ready', { plan: plan([step(0, 'first')]) }, 1),
      env('task.completed', { summary: 'wrote CONTRIBUTING.md', artifacts: [{ kind: 'file', path: 'CONTRIBUTING.md' }] }, 2),
    ]);

    expect(snapshot.task?.status).toBe('done');
    expect(snapshot.task?.progress).toBe(1);
    expect(snapshot.task?.summary).toBe('wrote CONTRIBUTING.md');
    expect(snapshot.task?.artifacts[0]?.path).toBe('CONTRIBUTING.md');
  });

  it('projects pause and resume', () => {
    const paused = fold([
      env('task.received', { task: task() }, 0),
      env('task.paused', { reason: 'user paused' }, 1),
    ]);
    expect(paused.task?.status).toBe('paused');
    expect(paused.task?.pausedReason).toBe('user paused');

    const resumed = applyEvent(paused, env('task.resumed', { fromStatus: 'paused' }, 2));
    expect(resumed.task?.status).toBe('executing');
    expect(resumed.task?.pausedReason).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// tools & approvals
// ---------------------------------------------------------------------------

describe('projection — tool calls and approvals', () => {
  it('exposes tool input, output, duration and status', () => {
    const snapshot = fold([
      env('task.received', { task: task() }, 0),
      env('tool.requested', { call: toolCall() }, 1),
      env('tool.started', { callId: 'call-1', name: 'fs.write' }, 2),
      env('tool.finished', { call: toolCall({ status: 'ok', output: { bytes: 5 }, durationMs: 12 }) }, 3),
    ]);

    const call = snapshot.task?.toolCalls['call-1'];
    expect(call?.status).toBe('ok');
    expect(call?.input).toEqual({ path: 'a.txt', content: 'hello' });
    expect(call?.output).toEqual({ bytes: 5 });
    expect(call?.durationMs).toBe(12);
    expect(call?.risk).toBe('write');
  });

  it('raises an approval request and clears it on approve', () => {
    const requested = fold([
      env('task.received', { task: task() }, 0),
      env('tool.approval_required', { call: toolCall({ status: 'awaiting-approval', risk: 'privileged' }) }, 1),
    ]);

    expect(requested.task?.approvals).toHaveLength(1);
    expect(requested.task?.approvals[0]?.risk).toBe('privileged');
    expect(requested.task?.activity.kind).toBe('waiting-approval');
    expect(requested.task?.toolCalls['call-1']?.approval).toBe('required');

    const approved = applyEvent(requested, env('tool.approved', { callId: 'call-1', by: 'user' }, 2));
    expect(approved.task?.approvals).toHaveLength(0);
    expect(approved.task?.toolCalls['call-1']?.approval).toBe('approved');
  });

  it('records a denial with the reason', () => {
    const snapshot = fold([
      env('task.received', { task: task() }, 0),
      env('tool.approval_required', { call: toolCall({ status: 'awaiting-approval', risk: 'destructive' }) }, 1),
      env('tool.denied', { callId: 'call-1', reason: 'escapes workspace' }, 2),
    ]);

    expect(snapshot.task?.toolCalls['call-1']?.approval).toBe('denied');
    expect(snapshot.task?.toolCalls['call-1']?.error).toBe('escapes workspace');
  });

  it('surfaces a tool failure with a recovery suggestion', () => {
    const snapshot = fold([
      env('task.received', { task: task() }, 0),
      env('tool.failed', { callId: 'call-1', name: 'fs.read', error: 'ENOENT: no such file', recoverable: true }, 1),
    ]);

    expect(snapshot.task?.failures).toHaveLength(1);
    expect(snapshot.task?.failures[0]?.recoverable).toBe(true);
    expect(snapshot.task?.failures[0]?.suggestion).toMatch(/retry/i);
  });

  it('classifies a failure and tracks recovery attempts', () => {
    const snapshot = fold([
      env('task.received', { task: task() }, 0),
      env('tool.failed', { callId: 'call-1', name: 'shell.exec', error: 'timed out', recoverable: true }, 1),
      env('recovery.classified', { errorClass: 'transient', message: 'timed out' }, 2),
      env('recovery.attempted', { strategy: 'retry', attempt: 1 }, 3),
    ]);

    const failure = snapshot.task?.failures[0];
    expect(failure?.errorClass).toBe('transient');
    expect(failure?.attempts).toBe(1);
    expect(failure?.strategy).toBe('retry');
  });
});

// ---------------------------------------------------------------------------
// context
// ---------------------------------------------------------------------------

describe('projection — context window and compaction', () => {
  it('projects token budget into a usage ratio', () => {
    const snapshot = fold([
      env('task.received', { task: task() }, 0),
      env('context.budget', { budget: { window: 1000, softLimit: 800, used: 250 } }, 1),
    ]);

    expect(snapshot.task?.context.window).toBe(1000);
    expect(contextUsage(snapshot.task!.context)).toBeCloseTo(0.25);
  });

  it('records a compaction with its protected slots, summaries and dropped originals', () => {
    const snapshot = fold([
      env('task.received', { task: task() }, 0),
      env('context.budget', { budget: { window: 1000, softLimit: 800, used: 950 } }, 1),
      env('context.compacted', {
        tokensBefore: 950,
        tokensAfter: 300,
        droppedMessages: 12,
        summaries: ['Earlier: inspected package.json'],
        droppedPreviews: [
          { role: 'user', content: 'inspect package.json and report the scripts', truncated: false },
          { role: 'tool', name: 'fs.read', content: '{"name":"camelia"}', truncated: false },
        ],
        protectedSlots: ['goal', 'constraints'],
      }, 2),
    ]);

    const compaction = snapshot.task?.context.compactions[0];
    expect(compaction?.droppedMessages).toBe(12);
    expect(compaction?.protectedSlots).toContain('goal');
    expect(compaction?.summaries[0]).toMatch(/package\.json/);
    expect(compaction?.droppedPreviews).toHaveLength(2);
    expect(compaction?.droppedPreviews[0]?.content).toMatch(/inspect package\.json/);
    expect(compaction?.droppedPreviews[1]?.name).toBe('fs.read');
    expect(snapshot.task?.context.used).toBe(300);
  });
});

// ---------------------------------------------------------------------------
// reliability & sub-agents
// ---------------------------------------------------------------------------

describe('projection — reliability notices and sub-agents', () => {
  it('turns drift, loop and hallucination events into visible notices', () => {
    const snapshot = fold([
      env('task.received', { task: task() }, 0),
      env('reliability.drift_detected', { score: 0.7, signals: ['files diverge'], action: 'reanchor' }, 1),
      env('reliability.loop_detected', { fingerprint: 'fs.read a.txt', repeats: 3, action: 'break-step' }, 2),
      env('reliability.hallucination_blocked', { claim: 'all tests pass', reason: 'no evidence' }, 3),
    ]);

    const kinds = snapshot.task?.notices.map((n) => n.kind);
    expect(kinds).toEqual(['drift', 'loop', 'hallucination']);
    expect(snapshot.task?.notices[0]?.action).toBe('reanchor');
  });

  it('tracks a sub-agent from spawn to report', () => {
    const spawned = fold([
      env('task.received', { task: task() }, 0),
      env('subagent.spawned', { id: 'sub-1', goal: 'scan the repo', parentTaskId: TASK_ID }, 1),
    ]);
    expect(spawned.task?.subAgents[0]?.status).toBe('running');

    const finished = applyEvent(spawned, env('subagent.finished', { report: report() }, 2));
    expect(finished.task?.subAgents[0]?.status).toBe('ok');
    expect(finished.task?.subAgents[0]?.tokensUsed).toBe(120);
  });

  it('projects provider fallback', () => {
    const snapshot = fold([
      env('provider.selected', { providerId: 'opencode-zen', model: 'zen-1', reason: 'primary' }, 0),
      env('provider.fallback', { from: 'opencode-zen', to: 'openrouter', reason: 'rate limit', depth: 1 }, 1),
    ]);

    expect(snapshot.provider.activeProvider).toBe('openrouter');
    expect(snapshot.provider.fallbacks).toHaveLength(1);
    expect(snapshot.provider.fallbacks[0]?.reason).toBe('rate limit');
  });

  it('records checkpoints for rollback', () => {
    const snapshot = fold([
      env('task.received', { task: task() }, 0),
      env('checkpoint.created', { checkpoint: checkpoint() }, 1),
    ]);

    expect(snapshot.task?.checkpoints[0]?.stepIdx).toBe(0);
    expect(snapshot.task?.checkpoints[0]?.ctxSummary).toBe('after step 0');
  });
});

// ---------------------------------------------------------------------------
// assistant narration
// ---------------------------------------------------------------------------

describe('projection — assistant narration', () => {
  it('folds streamed chunks into one narration entry per step', () => {
    const snapshot = fold([
      env('task.received', { task: task() }, 0),
      env('plan.ready', { plan: plan([step(0, 'first'), step(1, 'second')]) }, 1),
      env('step.started', { step: step(0, 'first') }, 2),
      env('log', { level: 'debug', message: 'I will ', meta: { stream: true } }, 3),
      env('log', { level: 'debug', message: 'read the file.', meta: { stream: true } }, 4),
      env('tool.requested', { call: toolCall() }, 5),
      env('step.started', { step: step(1, 'second') }, 6),
      env('log', { level: 'debug', message: 'Now editing.', meta: { stream: true } }, 7),
    ]);

    const narration = snapshot.task!.narration;
    expect(narration).toHaveLength(2);
    expect(narration[0]?.text).toBe('I will read the file.');
    expect(narration[0]?.streaming).toBe(false);
    expect(narration[1]?.text).toBe('Now editing.');
    expect(narration[1]?.stepIdx).toBe(1);
  });

  it('ignores non-streamed logs so the audit trail stays out of the conversation', () => {
    const snapshot = fold([
      env('task.received', { task: task() }, 0),
      env('log', { level: 'info', message: 'not narration' }, 1),
    ]);
    expect(snapshot.task?.narration).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// determinism & bounds
// ---------------------------------------------------------------------------

describe('projection — determinism and bounds', () => {
  it('is deterministic: the same events fold to an identical snapshot', () => {
    const events: DomainEvent[] = [
      env('task.received', { task: task() }, 0),
      env('plan.ready', { plan: plan([step(0, 'first')]) }, 1),
      env('step.started', { step: step(0, 'first') }, 2),
      env('tool.requested', { call: toolCall() }, 3),
      env('task.completed', { summary: 'done', artifacts: [] }, 4),
    ];

    expect(fold(events)).toEqual(fold(events));
  });

  it('keeps the timeline bounded under an event storm', () => {
    const events: DomainEvent[] = Array.from({ length: 500 }, (_v, i) =>
      env('metric', { name: 'loop.iterations', value: i }, i),
    );

    const snapshot = fold(events);
    expect(snapshot.timeline.length).toBeLessThanOrEqual(400);
    expect(snapshot.metrics['loop.iterations']).toBe(499);
  });

  it('attaches a session without touching task state', () => {
    const snapshot = withSession(initialSnapshot(), {
      id: SESSION_ID,
      title: 'Refactor the router',
      workspace: 'C:/repo',
      provider: 'ollama',
      model: 'qwen2.5-coder',
    });

    expect(snapshot.session?.title).toBe('Refactor the router');
    expect(snapshot.task).toBeUndefined();
  });

  it('computes progress by weight, not by count', () => {
    const steps = [
      { id: 'a', idx: 0, title: 'a', goal: '', status: 'done' as const, weight: 9, acceptance: [] },
      { id: 'b', idx: 1, title: 'b', goal: '', status: 'pending' as const, weight: 1, acceptance: [] },
    ];
    expect(computeProgress(steps)).toBeCloseTo(0.9);
  });
});

// ---------------------------------------------------------------------------
// provider connection state (Iteration 25)
// ---------------------------------------------------------------------------

describe('toProviderStatus', () => {
  it('marks connected and names the active provider', () => {
    const status = toProviderStatus(
      [
        { id: 'aliyun', label: 'Aliyun', model: 'qwen-plus', active: true },
        { id: 'ollama', label: 'Ollama', model: 'qwen2.5-coder:7b', active: false },
      ],
      'qwen-plus',
    );
    expect(status).toEqual({
      state: 'connected',
      id: 'aliyun',
      model: 'qwen-plus',
      chain: ['aliyun', 'ollama'],
    });
  });

  it('falls back to the active entry model when the router reports none', () => {
    const status = toProviderStatus([{ id: 'ollama', label: 'Ollama', model: 'qwen2.5-coder:7b', active: true }]);
    expect(status.model).toBe('qwen2.5-coder:7b');
  });

  it('reports unavailable when no entry is active', () => {
    const status = toProviderStatus([{ id: 'ollama', label: 'Ollama', model: 'qwen2.5-coder', active: false }]);
    expect(status.state).toBe('unavailable');
    expect(status.id).toBeUndefined();
    expect(status.model).toBeUndefined();
    expect(status.chain).toEqual(['ollama']);
  });
});

describe('withProviderStatus', () => {
  it('records the connection state and the chain', () => {
    const snapshot = withProviderStatus(initialSnapshot(), {
      state: 'connected',
      id: 'aliyun',
      model: 'qwen-plus',
      chain: ['aliyun', 'ollama'],
    });
    expect(snapshot.provider.connected).toBe(true);
    expect(snapshot.provider.activeProvider).toBe('aliyun');
    expect(snapshot.provider.activeModel).toBe('qwen-plus');
    expect(snapshot.provider.chain).toEqual(['aliyun', 'ollama']);
  });

  it('distinguishes "not asked yet" from "no provider"', () => {
    // No status → the field stays undefined, so the UI can render "connecting" rather
    // than claiming the engine has no provider.
    expect(initialSnapshot().provider.connected).toBeUndefined();

    const unavailable = withProviderStatus(initialSnapshot(), {
      state: 'unavailable',
      chain: [],
    });
    expect(unavailable.provider.connected).toBe(false);
    expect(unavailable.provider.activeProvider).toBeUndefined();
  });

  it('never overwrites a provider a run has already selected', () => {
    // A run's `provider.selected` event carries the routing actually taken, including a
    // fallback; the boot-time status must not clobber it with the configured primary.
    const afterRun = fold([
      env('provider.selected', { providerId: 'openrouter', model: 'qwen3-coder:free', reason: 'cheap-first' }, 1),
    ]);
    const withStatus = withProviderStatus(afterRun, {
      state: 'connected',
      id: 'aliyun',
      model: 'qwen-plus',
      chain: ['aliyun', 'ollama'],
    });
    expect(withStatus.provider.activeProvider).toBe('openrouter');
    expect(withStatus.provider.activeModel).toBe('qwen3-coder:free');
    // The connection fact is still recorded.
    expect(withStatus.provider.connected).toBe(true);
  });

  it('is a no-op without a status payload', () => {
    const base = initialSnapshot();
    expect(withProviderStatus(base, undefined)).toBe(base);
  });
});

// ---------------------------------------------------------------------------
// remaining lifecycle events (status, plan revision, recovery, housekeeping)
// ---------------------------------------------------------------------------

describe('projection — remaining lifecycle events', () => {
  it('maps every task status to an activity kind', () => {
    const statuses: TaskStatus[] = [
      'received',
      'clarifying',
      'planning',
      'executing',
      'verifying',
      'delivering',
      'reflecting',
      'done',
      'failed',
      'cancelled',
      'paused',
    ];
    const kinds = Object.fromEntries(
      statuses.map((to) => [
        to,
        fold([
          env('task.received', { task: task() }, 0),
          env('task.status_changed', { from: 'received', to, reason: 'test' }, 1),
        ]).task!.activity.kind,
      ]),
    );

    expect(kinds.clarifying).toBe('planning');
    expect(kinds.planning).toBe('planning');
    expect(kinds.executing).toBe('executing');
    expect(kinds.verifying).toBe('verifying');
    expect(kinds.delivering).toBe('delivering');
    expect(kinds.reflecting).toBe('delivering');
    expect(kinds.done).toBe('idle');
    expect(kinds.failed).toBe('idle');
    expect(kinds.cancelled).toBe('idle');
    expect(kinds.paused).toBe('idle');
    expect(kinds.received).toBe('idle');
  });

  it('keeps the current step detail when the status re-asserts executing', () => {
    const snapshot = fold([
      env('task.received', { task: task() }, 0),
      env('plan.ready', { plan: plan([step(0, 'first')]) }, 1),
      env('step.started', { step: step(0, 'first') }, 2),
      env('task.status_changed', { from: 'executing', to: 'executing', reason: 'still going' }, 3),
    ]);
    expect(snapshot.task?.activity.detail).toBe('first');
  });

  it('projects phase changes and progress events', () => {
    const snapshot = fold([
      env('task.received', { task: task() }, 0),
      env('task.phase_changed', { phase: 'executing' }, 1),
      env('task.progress', { progress: 0.4, currentStepIdx: 2, totalSteps: 5 }, 2),
    ]);
    expect(snapshot.task?.phase).toBe('executing');
    expect(snapshot.task?.progress).toBe(0.4);
    expect(snapshot.task?.currentStepIdx).toBe(2);
    expect(snapshot.task?.stepsTotal).toBe(5);
  });

  it('projects task failure with a recoverable and a hard suggestion', () => {
    const soft = fold([
      env('task.received', { task: task() }, 0),
      env('task.failed', { reason: 'budget exhausted', recoverable: true }, 1),
    ]);
    expect(soft.task?.status).toBe('failed');
    expect(soft.task?.failures[0]?.suggestion).toMatch(/retry/i);

    const hard = fold([
      env('task.received', { task: task() }, 0),
      env('task.failed', { reason: 'fatal', recoverable: false }, 1),
    ]);
    expect(hard.task?.failures[0]?.suggestion).toMatch(/re-state/i);
  });

  it('projects cancellation', () => {
    const snapshot = fold([
      env('task.received', { task: task() }, 0),
      env('task.cancelled', { reason: 'user stopped it' }, 1),
    ]);
    expect(snapshot.task?.status).toBe('cancelled');
  });

  it('revises the plan and preserves a step that already ran', () => {
    const snapshot = fold([
      env('task.received', { task: task() }, 0),
      env('plan.ready', { plan: plan([step(0, 'first'), step(1, 'second')]) }, 1),
      env('step.started', { step: step(0, 'first') }, 2),
      env('step.completed', { step: step(0, 'first'), result: { stepId: 'step-0', status: 'ok', toolCalls: [], summary: '', artifacts: [] }, score: 3 }, 3),
      env(
        'plan.revised',
        { previousRevision: 1, plan: plan([step(0, 'first'), step(1, 'second'), step(2, 'third')]), reason: 'found another sub-task' },
        4,
      ),
    ]);

    // A re-stated step keeps its live status rather than resetting to pending.
    expect(snapshot.task?.steps.find((s) => s.id === 'step-0')?.status).toBe('done');
    expect(snapshot.task?.steps).toHaveLength(3);
    expect(snapshot.task?.notices.some((n) => n.action === 'replan')).toBe(true);
  });

  it('projects a failed plan as a recoverable failure', () => {
    const snapshot = fold([
      env('task.received', { task: task() }, 0),
      env('plan.failed', { reason: 'model returned no plan' }, 1),
    ]);
    expect(snapshot.task?.failures[0]?.reason).toBe('model returned no plan');
    expect(snapshot.task?.failures[0]?.recoverable).toBe(true);
  });

  it('projects a failed step and counts a skipped step as progress', () => {
    const snapshot = fold([
      env('task.received', { task: task() }, 0),
      env('plan.ready', { plan: plan([step(0, 'first'), step(1, 'second', { weight: 3 })]) }, 1),
      env('step.failed', { step: step(0, 'first'), error: 'boom', score: -3 }, 2),
      env('step.skipped', { step: step(1, 'second', { weight: 3 }), reason: 'not needed' }, 3),
    ]);
    const first = snapshot.task?.steps.find((s) => s.id === 'step-0');
    const second = snapshot.task?.steps.find((s) => s.id === 'step-1');
    expect(first?.status).toBe('failed');
    expect(first?.error).toBe('boom');
    expect(second?.status).toBe('skipped');
    expect(snapshot.task?.progress).toBeCloseTo(0.75);
  });

  it('records a fix-required verdict as a notice', () => {
    const snapshot = fold([
      env('task.received', { task: task() }, 0),
      env('verify.fix_required', { stepId: 'step-0', verdicts: [verdict({ status: 'fail', reason: 'missing export' })] }, 1),
    ]);
    expect(snapshot.task?.notices[0]?.action).toBe('fix');
    expect(snapshot.task?.notices[0]?.detail).toMatch(/missing export/);
  });

  it('projects compaction start and deduplication', () => {
    const snapshot = fold([
      env('task.received', { task: task() }, 0),
      env('context.compaction_started', { tokensBefore: 900, reason: 'soft-limit' }, 1),
      env('context.deduplicated', { removed: 4 }, 2),
    ]);
    expect(snapshot.task?.activity.detail).toMatch(/Compacting context/);
    expect(snapshot.task?.context.deduplicated).toBe(4);
  });

  it('projects a no-progress notice', () => {
    const snapshot = fold([
      env('task.received', { task: task() }, 0),
      env('reliability.no_progress', { streak: 3, action: 'reanchor' }, 1),
    ]);
    expect(snapshot.task?.notices[0]?.kind).toBe('no-progress');
    expect(snapshot.task?.notices[0]?.title).toMatch(/3/);
  });

  it('projects the full recovery lifecycle', () => {
    const snapshot = fold([
      env('task.received', { task: task() }, 0),
      env('recovery.rollback_started', { checkpointId: 'cp-1' }, 1),
      env('recovery.rollback_done', { checkpointId: 'cp-1', restored: 2 }, 2),
      env('recovery.succeeded', { strategy: 'retry', attempts: 2 }, 3),
      env('recovery.failed', { strategy: 'degrade', attempts: 3, error: 'gave up' }, 4),
    ]);
    expect(snapshot.task?.notices.some((n) => n.action === 'rolled-back')).toBe(true);
    expect(snapshot.task?.notices.some((n) => n.action === 'resumed')).toBe(true);
    expect(snapshot.task?.failures.at(-1)?.strategy).toBe('degrade');
    expect(snapshot.task?.failures.at(-1)?.recoverable).toBe(false);
  });

  it('keeps provider capabilities and memory writes in the timeline only', () => {
    const snapshot = fold([
      env('task.received', { task: task() }, 0),
      env(
        'provider.capabilities',
        {
          providerId: 'ollama',
          capabilities: { supportsTools: true, supportsJson: true, supportsStreaming: true, maxContextWindow: 8000, quality: 0.6 },
        },
        1,
      ),
      env('memory.written', { count: 2, kind: 'episodic', contentSnippet: 'two episodic notes' }, 2),
    ]);
    expect(snapshot.timeline.map((e) => e.type)).toContain('provider.capabilities');
    expect(snapshot.timeline.map((e) => e.type)).toContain('memory.written');
  });

  it('handles events that arrive before any task exists', () => {
    const snapshot = fold([env('step.started', { step: step(0, 'orphan') }, 0)]);
    expect(snapshot.task).toBeUndefined();
    expect(snapshot.timeline).toHaveLength(1);
  });

  it('bounds the notice list under a notice storm', () => {
    const storm: DomainEvent[] = Array.from({ length: 60 }, (_v, i) =>
      env('reliability.no_progress', { streak: i, action: 'reanchor' }, i),
    );
    const snapshot = fold([env('task.received', { task: task() }, 0), ...storm]);
    expect(snapshot.task!.notices.length).toBeLessThanOrEqual(50);
  });

  it('treats an empty plan and a zero-width window as no usage', () => {
    expect(computeProgress([])).toBe(0);
    expect(contextUsage({ window: 0, softLimit: 0, used: 10, compactions: [], deduplicated: 0 })).toBe(0);
  });

  it('summarises every memory and self-review timeline event (Iteration 20/21 coverage)', () => {
    const snapshot = fold([
      env('selfreview.performed', {
        decisionPoint: 'planning', verdict: 'revise', mode: 'full', planId: 'p1',
        questions: [{ id: 'scope', status: 'fail', detail: 'out of scope' }],
      }, 0),
      env('selfreview.skipped', { decisionPoint: 'planning', reason: 'fast-path' }, 1),
      env('memory.written', { count: 1, kind: 'procedural', contentSnippet: 'When asked to scaffold…' }, 2),
      env('memory.recalled', {
        count: 2, ids: ['a', 'b'], noise: 0.5,
        provenance: [{ memoryId: 'a', layer: 'procedural', matchedBy: 'todo' }, { memoryId: 'b', layer: 'long', matchedBy: '' }],
      }, 3),
      env('memory.forgotten', { memoryId: 'b', contentSnippet: 'flag spelling', reason: 'budget-eviction', value: 0.1 }, 4),
      env('memory.reactivated', { memoryId: 'a', nextReviewAt: 5 }, 5),
      env('memory.downgraded', { memoryId: 'a', reason: 'task-verification-gap', correctness: 0 }, 6),
      env('tool.usage_injected', { name: 'git', chars: 120 }, 7),
    ]);
    const summaries = new Map(snapshot.timeline.map((e) => [e.type, e.summary]));
    expect(summaries.get('selfreview.performed')).toContain('planning');
    expect(summaries.get('selfreview.performed')).toContain('revise');
    expect(summaries.get('selfreview.skipped')).toContain('fast-path');
    expect(summaries.get('memory.written')).toContain('procedural');
    expect(summaries.get('memory.recalled')).toContain('procedural'); // provenance layers surfaced
    expect(summaries.get('memory.recalled')).toContain('long');
    expect(summaries.get('memory.forgotten')).toContain('budget-eviction');
    expect(summaries.get('memory.reactivated')).toContain('a');
    expect(summaries.get('memory.downgraded')).toContain('task-verification-gap');
    expect(summaries.get('tool.usage_injected')).toContain('git');
  });
});
import { toSessionView } from '../src/view/wire.js';

describe('toSessionView (Iteration 24)', () => {
  it('projects a persisted Session to the UI row shape', () => {
    const view = toSessionView({
      id: 'sess-1',
      title: 't',
      workspace: 'C:/ws',
      provider: 'ollama',
      model: 'qwen2.5-coder:7b',
      createdAt: 0,
      updatedAt: 0,
    });
    expect(view).toEqual({ id: 'sess-1', title: 't', workspace: 'C:/ws', provider: 'ollama', model: 'qwen2.5-coder:7b' });
  });
});

// ---------------------------------------------------------------------------
// chat — the direct conversation path folds into `snapshot.chat`, parallel to
// the task projection and never inside it.
// ---------------------------------------------------------------------------

const TURN_USER = 'turn-user';
const TURN_ASST = 'turn-asst';

function chatTurnEvents(): DomainEvent[] {
  return [
    env('chat.received', { turnId: TURN_USER, text: 'hello' }, 100),
    env('chat.delta', { turnId: TURN_ASST, delta: 'Hi ' }, 110),
    env('chat.delta', { turnId: TURN_ASST, delta: 'there' }, 120),
    env('chat.message', { turnId: TURN_ASST, role: 'assistant', text: 'Hi there' }, 130),
  ];
}

describe('chat projection (对话 mode)', () => {
  it('folds a direct reply into user + assistant turns, never into the task', () => {
    const snapshot = reduceEvents(initialSnapshot(), chatTurnEvents());
    expect(snapshot.chat.turns.map((t) => [t.role, t.text])).toEqual([
      ['user', 'hello'],
      ['assistant', 'Hi there'],
    ]);
    expect(snapshot.chat.turns[1]!.streaming).toBe(false);
    expect(snapshot.task).toBeUndefined();
    expect(snapshot.chat.pendingAsk).toBeUndefined();
  });

  it('lands tool cards on the turn the call names and keeps status transitions', () => {
    const call: ToolCall = {
      id: 'call-1',
      stepId: TURN_ASST,
      taskId: TURN_ASST,
      name: 'fs.list',
      input: { dir: '.' },
      status: 'pending',
      risk: 'read-only',
      reversible: true,
      traceId: 'trace',
      createdAt: 115,
    };
    const run = (status: ToolCall['status'], extra: Partial<ToolCall> = {}): DomainEvent =>
      env('chat.tool', { call: { ...call, status, ...extra } }, 140);
    const snapshot = reduceEvents(initialSnapshot(), [
      ...chatTurnEvents(),
      run('pending'),
      run('awaiting-approval'),
      run('approved'),
      run('running'),
      run('ok', { output: { entries: ['a.txt'] }, durationMs: 12 }),
    ]);
    const cards = snapshot.chat.turns[1]!.toolCalls;
    expect(cards).toHaveLength(1);
    expect(cards[0]!.status).toBe('ok');
    expect(cards[0]!.output).toEqual({ entries: ['a.txt'] });
    expect(cards[0]!.durationMs).toBe(12);
  });

  it('shows the ask_user picker, then swaps it for the answered option as a user turn', () => {
    const base = [
      ...chatTurnEvents(),
      env('chat.ask_user', { askId: 'ask-1', question: 'Which one?', options: ['A', 'B'] }, 140),
    ];
    const open = reduceEvents(initialSnapshot(), base);
    expect(open.chat.pendingAsk).toMatchObject({ askId: 'ask-1', question: 'Which one?', options: ['A', 'B'] });

    // A concrete answer clears the picker and adds the choice as a user turn.
    const answered = reduceEvents(open, [env('chat.answered', { askId: 'ask-1', optionIdx: 1 }, 150)]);
    expect(answered.chat.pendingAsk).toBeUndefined();
    expect(answered.chat.turns.at(-1)).toMatchObject({ role: 'user', text: 'B' });

    // A dismissal (optionIdx -1) clears the picker without inventing a turn.
    const dismissed = reduceEvents(open, [env('chat.answered', { askId: 'ask-1', optionIdx: -1 }, 150)]);
    expect(dismissed.chat.pendingAsk).toBeUndefined();
    expect(dismissed.chat.turns).toEqual(open.chat.turns);
  });

  it('marks the assistant turn failed in place instead of dropping the partial text', () => {
    const snapshot = reduceEvents(initialSnapshot(), [
      env('chat.received', { turnId: TURN_USER, text: 'hello' }, 100),
      env('chat.delta', { turnId: TURN_ASST, delta: 'partial' }, 110),
      env('chat.failed', { turnId: TURN_ASST, error: 'provider down' }, 120),
    ]);
    expect(snapshot.chat.turns).toHaveLength(2);
    expect(snapshot.chat.turns[1]).toMatchObject({ text: 'partial', streaming: false, error: 'provider down' });
  });

  it('ignores a chat.message whose turn was never opened (defensive fold)', () => {
    const snapshot = reduceEvents(initialSnapshot(), [
      env('chat.message', { turnId: 'ghost', role: 'assistant', text: 'nope' }, 100),
    ]);
    expect(snapshot.chat.turns).toEqual([]);
  });

  it('mirrors the permission posture and caps the transcript at 80 whole turns', () => {
    expect(reduceEvents(initialSnapshot(), [env('chat.policy_changed', { policy: 'ask' }, 1)]).chat.policy).toBe('ask');

    const many: DomainEvent[] = [];
    for (let i = 0; i < 41; i += 1) {
      many.push(env('chat.received', { turnId: `u${i}`, text: `q${i}` }, 10 * i));
      many.push(env('chat.delta', { turnId: `a${i}`, delta: `r${i}` }, 10 * i + 1));
      many.push(env('chat.message', { turnId: `a${i}`, role: 'assistant', text: `r${i}` }, 10 * i + 2));
    }
    const snapshot = reduceEvents(initialSnapshot(), many);
    expect(snapshot.chat.turns).toHaveLength(80);
    // The cap drops whole (user, assistant) pairs from the front — 82 folded, u0/a0 gone.
    expect(snapshot.chat.turns[0]).toMatchObject({ id: 'u1', role: 'user' });
    expect(snapshot.chat.turns.at(-1)).toMatchObject({ id: 'a40', role: 'assistant' });
  });
});

/**
 * Event renderer — the CLI's projection of task state (whitepaper §6).
 *
 * The renderer holds no state the backend does not own, so these tests assert on
 * what the user *sees* for a given lifecycle event: which phase, which step, did
 * the tool succeed, was the result verified. Plain theme keeps the assertions on
 * structure rather than ANSI codes.
 * @module
 */

import type { DomainEvent, JsonValue, Plan, Step, StepResult, ToolCall, Verdict } from '@camelia/core';
import { EventBus } from '@camelia/core';
import { describe, expect, it } from 'vitest';

import { EventRenderer } from '../src/render.js';
import { createTheme } from '../src/theme.js';

const theme = createTheme(false);

function step(idx: number, title: string): Step {
  return {
    id: `step-${idx}`,
    taskId: 'task-1',
    idx,
    title,
    goal: title,
    status: 'pending',
    acceptance: [],
    weight: 1,
    deps: [],
  };
}

function plan(steps: Step[]): Plan {
  return { id: 'plan-1', taskId: 'task-1', steps, mode: 'fast', revision: 0, createdAt: 0 };
}

function stepResult(summary: string): StepResult {
  return { stepId: 'step-0', status: 'ok', toolCalls: [], summary, artifacts: [] };
}

function toolCall(name: string, input: JsonValue, status: ToolCall['status'] = 'ok'): ToolCall {
  return {
    id: 'call-1',
    stepId: 'step-0',
    taskId: 'task-1',
    name,
    input,
    status,
    risk: 'write',
    reversible: true,
    durationMs: 12,
    traceId: 'trace-1',
    createdAt: 0,
  };
}

function verdict(status: Verdict['status'], reason: string, evidence = 0): Verdict {
  return {
    id: 'verdict-1',
    stepId: 'step-0',
    taskId: 'task-1',
    status,
    evidence: Array.from({ length: evidence }, (_, i) => ({ kind: 'assertion' as const, ref: `e${i}` })),
    reason,
    createdAt: 0,
  };
}

/** Attach a renderer, emit events, return the captured lines. */
function capture(
  events: DomainEvent[],
  options: { quiet?: boolean; verbose?: boolean } = {},
): string[] {
  const bus = new EventBus();
  const lines: string[] = [];
  const renderer = new EventRenderer(bus, {
    theme,
    write: (line) => lines.push(line),
    quiet: options.quiet ?? false,
    verbose: options.verbose ?? false,
  });
  const off = renderer.attach();
  for (const event of events) bus.emitEvent(event);
  off();
  return lines;
}

function event<T extends DomainEvent['type']>(type: T, payload: unknown): DomainEvent {
  return { type, payload, traceId: 'trace-1', ts: 0 } as DomainEvent;
}

describe('EventRenderer — phase projection', () => {
  it('prints the phase once and suppresses repeats', () => {
    const lines = capture([
      event('task.phase_changed', { phase: 'planning' }),
      event('task.phase_changed', { phase: 'planning' }),
      event('task.phase_changed', { phase: 'executing' }),
    ]);
    expect(lines).toEqual(['\u25d0 planning\n', '\u25d0 executing\n']);
  });

  it('never prints the idle phase', () => {
    const lines = capture([event('task.phase_changed', { phase: 'idle' })]);
    expect(lines).toEqual([]);
  });
});

describe('EventRenderer — plan and steps', () => {
  it('lists every planned step with a 1-based number', () => {
    const lines = capture([event('plan.ready', { plan: plan([step(0, 'First'), step(1, 'Second')]) })]);
    expect(lines[0]).toContain('plan');
    expect(lines[0]).toContain('2 steps');
    expect(lines[1]).toContain('1. First');
    expect(lines[2]).toContain('2. Second');
  });

  it('uses the singular for a one-step plan', () => {
    const lines = capture([event('plan.ready', { plan: plan([step(0, 'Only')]) })]);
    expect(lines[0]).toContain('1 step');
    expect(lines[0]).not.toContain('1 steps');
  });

  it('shows a completed step, with the summary only when verbose', () => {
    const quietish = capture([event('step.completed', { step: step(0, 'Do it'), result: stepResult('did the thing') })]);
    expect(quietish.join('')).toContain('step done');
    expect(quietish.join('')).not.toContain('did the thing');

    const verbose = capture([event('step.completed', { step: step(0, 'Do it'), result: stepResult('did the thing') })], {
      verbose: true,
    });
    expect(verbose.join('')).toContain('did the thing');
  });

  it('shows a failed step with its error', () => {
    const lines = capture([event('step.failed', { step: step(2, 'Broken'), error: 'boom' })]);
    expect(lines.join('')).toContain('step failed');
    expect(lines.join('')).toContain('boom');
  });
});

describe('EventRenderer — tools', () => {
  it('summarises a file tool by its path', () => {
    const lines = capture([event('tool.finished', { call: toolCall('fs.write', { path: 'src/a.ts' }) })]);
    expect(lines.join('')).toContain('fs.write');
    expect(lines.join('')).toContain('src/a.ts');
    expect(lines.join('')).toContain('12ms');
  });

  it('summarises a shell tool by its command', () => {
    const lines = capture([event('tool.finished', { call: toolCall('shell.exec', { command: 'npm test' }) })]);
    expect(lines.join('')).toContain('npm test');
  });

  it('surfaces a denied tool call', () => {
    const lines = capture([event('tool.denied', { callId: 'call-1', reason: 'policy' })]);
    expect(lines.join('')).toContain('denied');
    expect(lines.join('')).toContain('policy');
  });

  it('surfaces a failed tool call', () => {
    const lines = capture([event('tool.failed', { callId: 'call-1', name: 'fs.write', error: 'EACCES', recoverable: false })]);
    expect(lines.join('')).toContain('fs.write');
    expect(lines.join('')).toContain('EACCES');
  });
});

describe('EventRenderer — verification', () => {
  it('stays silent on a pass unless verbose', () => {
    expect(capture([event('verify.result', { verdict: verdict('pass', 'ok', 2) })])).toEqual([]);
    const verbose = capture([event('verify.result', { verdict: verdict('pass', 'ok', 2) })], { verbose: true });
    expect(verbose.join('')).toContain('verified');
    expect(verbose.join('')).toContain('2 check(s)');
  });

  it('always surfaces an unverified step — it is not a silent pass', () => {
    const lines = capture([event('verify.result', { verdict: verdict('unknown', 'no evidence') })]);
    expect(lines.join('')).toContain('unverified');
    expect(lines.join('')).toContain('no evidence');
  });

  it('always surfaces a verification failure', () => {
    const lines = capture([event('verify.result', { verdict: verdict('fail', 'file missing') })]);
    expect(lines.join('')).toContain('verification failed');
  });
});

describe('EventRenderer — reliability and context', () => {
  it('announces a context compaction with the token delta and summaries', () => {
    const lines = capture([
      event('context.compacted', {
        tokensBefore: 9000,
        tokensAfter: 3000,
        droppedMessages: 12,
        summaries: ['compressed the early planning chatter'],
        protectedSlots: ['goal'],
      }),
    ]);
    expect(lines.join('')).toContain('context compacted');
    expect(lines.join('')).toContain('9000');
    expect(lines.join('')).toContain('3000');
    expect(lines.join('')).toContain('dropped 12');
    expect(lines.join('')).toContain('compressed the early planning chatter');
  });

  it('announces drift, loops, no-progress and blocked claims', () => {
    const lines = capture([
      event('reliability.drift_detected', { score: 0.72, signals: ['path-mismatch'], action: 'reanchor' }),
      event('reliability.loop_detected', { fingerprint: 'f', repeats: 3, action: 'break-step' }),
      event('reliability.no_progress', { streak: 4, action: 're-anchor-goal' }),
      event('reliability.hallucination_blocked', { claim: 'done', reason: 'no evidence' }),
    ]);
    const text = lines.join('');
    expect(text).toContain('drift detected');
    expect(text).toContain('0.72');
    expect(text).toContain('loop detected');
    expect(text).toContain('repeated 3x');
    expect(text).toContain('no progress');
    expect(text).toContain('unverified claim blocked');
  });

  it('announces rollback', () => {
    const lines = capture([
      event('recovery.rollback_started', { checkpointId: 'cp-1' }),
      event('recovery.rollback_done', { checkpointId: 'cp-1', restored: 3 }),
    ]);
    expect(lines.join('')).toContain('rolling back workspace');
    expect(lines.join('')).toContain('restored 3 file(s)');
  });
});

describe('EventRenderer — quiet mode', () => {
  it('suppresses everything except the terminal outcome', () => {
    const lines = capture(
      [
        event('task.phase_changed', { phase: 'executing' }),
        event('plan.ready', { plan: plan([step(0, 'First')]) }),
        event('step.started', { step: step(0, 'First') }),
        event('task.completed', { summary: 'ok', artifacts: [] }),
      ],
      { quiet: true },
    );
    // Only task.completed qualifies as an outcome event; the renderer prints nothing for it here.
    expect(lines).toEqual([]);
  });

  it('still prints failures in quiet mode', () => {
    const lines = capture([event('task.failed', { reason: 'verification failed', recoverable: false })], { quiet: true });
    expect(lines.join('')).toContain('failed');
    expect(lines.join('')).toContain('verification failed');
  });
});
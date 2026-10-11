import { describe, expect, it } from 'vitest';

import {
  TaskStateMachine,
  isTerminal,
  phaseOf,
} from '../src/state/TaskStateMachine.js';
import type { TaskStatus } from '../src/types/domain.js';

describe('phaseOf', () => {
  it('maps statuses to user-visible phases', () => {
    expect(phaseOf('received')).toBe('planning');
    expect(phaseOf('clarifying')).toBe('planning');
    expect(phaseOf('planning')).toBe('planning');
    expect(phaseOf('executing')).toBe('executing');
    expect(phaseOf('verifying')).toBe('verifying');
    expect(phaseOf('delivering')).toBe('delivering');
    expect(phaseOf('reflecting')).toBe('delivering');
    // Behavior evolution (Iteration 23): paused is its own phase, not idle.
    expect(phaseOf('paused')).toBe('paused');
    expect(phaseOf('awaiting-approval')).toBe('awaiting-approval');
    expect(phaseOf('done')).toBe('idle');
  });
});

describe('isTerminal', () => {
  it('identifies terminal states', () => {
    expect(isTerminal('done')).toBe(true);
    expect(isTerminal('failed')).toBe(true);
    expect(isTerminal('cancelled')).toBe(true);
    expect(isTerminal('executing')).toBe(false);
    expect(isTerminal('paused')).toBe(false);
  });
});

describe('TaskStateMachine', () => {
  it('starts at received and records history', () => {
    const sm = new TaskStateMachine();
    expect(sm.current).toBe('received');
    expect(sm.getHistory()).toHaveLength(1);
    expect(sm.phase).toBe('planning');
  });

  it('walks the happy path to done', () => {
    const sm = new TaskStateMachine();
    for (const to of ['clarifying', 'planning', 'awaiting-approval', 'executing', 'verifying', 'delivering', 'reflecting', 'done'] as TaskStatus[]) {
      const result = sm.transition(to);
      expect(result.ok).toBe(true);
    }
    expect(sm.current).toBe('done');
    expect(sm.isTerminal).toBe(true);
  });

  it('rejects illegal transitions without mutating state', () => {
    const sm = new TaskStateMachine();
    const result = sm.transition('done');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Illegal transition');
    expect(sm.current).toBe('received');
  });

  it('supports the replan back-edge from executing to planning', () => {
    const sm = new TaskStateMachine();
    sm.transition('planning');
    sm.transition('awaiting-approval');
    sm.transition('executing');
    expect(sm.transition('planning').ok).toBe(true);
    expect(sm.current).toBe('planning');
  });

  it('supports the fix back-edge from verifying to executing', () => {
    const sm = new TaskStateMachine();
    sm.transition('planning');
    sm.transition('awaiting-approval');
    sm.transition('executing');
    sm.transition('verifying');
    expect(sm.transition('executing').ok).toBe(true);
    expect(sm.current).toBe('executing');
  });

  it('pauses from any non-terminal state and remembers where to resume', () => {
    const sm = new TaskStateMachine();
    sm.transition('planning');
    sm.transition('awaiting-approval');
    sm.transition('executing');
    expect(sm.pause('user pressed pause').ok).toBe(true);
    expect(sm.current).toBe('paused');
    expect(sm.pausedFrom).toBe('executing');
    expect(sm.isPaused).toBe(true);
  });

  it('refuses to pause twice', () => {
    const sm = new TaskStateMachine();
    sm.pause();
    const again = sm.pause();
    expect(again.ok).toBe(false);
  });

  it('refuses to pause a terminal task', () => {
    const sm = new TaskStateMachine('done');
    expect(sm.pause().ok).toBe(false);
  });

  it('resumes back to the paused state and clears the resume target', () => {
    const sm = new TaskStateMachine();
    sm.transition('planning');
    sm.transition('awaiting-approval');
    sm.transition('executing');
    sm.pause();
    const result = sm.resume();
    expect(result.ok).toBe(true);
    expect(sm.current).toBe('executing');
    expect(sm.pausedFrom).toBeUndefined();
  });

  it('refuses to resume a task that is not paused', () => {
    const sm = new TaskStateMachine();
    expect(sm.resume().ok).toBe(false);
  });

  it('allows cancelling while paused', () => {
    const sm = new TaskStateMachine();
    sm.transition('planning');
    sm.pause();
    expect(sm.transition('cancelled').ok).toBe(true);
  });

  it('rejects transitions out of paused that are not the resume target', () => {
    const sm = new TaskStateMachine();
    sm.transition('planning');
    sm.transition('awaiting-approval');
    sm.transition('executing');
    sm.pause();
    expect(sm.canTransition('delivering')).toBe(false);
  });

  it('restores persisted state', () => {
    const sm = TaskStateMachine.restore('paused', 'verifying');
    expect(sm.current).toBe('paused');
    expect(sm.pausedFrom).toBe('verifying');
    expect(sm.resume().ok).toBe(true);
    expect(sm.current).toBe('verifying');
  });

  it('gates execution on awaiting-approval and can replan or cancel from there', () => {
    const sm = new TaskStateMachine();
    sm.transition('planning');
    expect(sm.transition('executing').ok).toBe(false);
    expect(sm.transition('awaiting-approval').ok).toBe(true);
    expect(sm.phase).toBe('awaiting-approval');
    expect(sm.transition('planning').ok).toBe(true);
    expect(sm.transition('awaiting-approval').ok).toBe(true);
    expect(sm.transition('cancelled').ok).toBe(true);
  });

  it('resumes a pause taken during awaiting-approval back to awaiting-approval', () => {
    const sm = new TaskStateMachine();
    sm.transition('planning');
    sm.transition('awaiting-approval');
    expect(sm.pause('hold').ok).toBe(true);
    expect(sm.phase).toBe('paused');
    expect(sm.resume().ok).toBe(true);
    expect(sm.current).toBe('awaiting-approval');
    expect(sm.phase).toBe('awaiting-approval');
  });

  it('records a reason for each transition', () => {
    const sm = new TaskStateMachine();
    sm.transition('planning', 'intent clarified');
    const history = sm.getHistory();
    expect(history[history.length - 1]?.reason).toBe('intent clarified');
  });
});
/**
 * Explicit task state machine.
 *
 * Why explicit (whitepaper §2.4): a hidden loop can't be interrupted, resumed,
 * audited or projected to a UI. Every legal transition is declared here.
 *
 * A status is promoted to its own `TaskPhase` only when both are true:
 * 1. Leaving it needs an outside actor (not pure engine progress).
 * 2. The UI must present it differently (another center view, or other controls).
 * `awaiting-approval` and `paused` meet both. Clarifying does not, so it stays
 * inside the `planning` phase.
 * @module
 */

import type { TaskPhase, TaskStatus } from '../types/domain.js';

/** Legal forward transitions. `paused` and terminal states are handled specially. */
const TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  received: ['clarifying', 'planning', 'failed', 'cancelled'],
  clarifying: ['planning', 'failed', 'cancelled'],
  planning: ['awaiting-approval', 'failed', 'cancelled'],
  // The only gate between a plan and execution. `planning` no longer jumps to `executing`.
  'awaiting-approval': ['executing', 'planning', 'cancelled', 'failed'],
  // `planning` is reachable from executing/verifying: that is the replan back-edge.
  // `delivering` is reachable from executing because verification happens *per
  // step* inside the loop, so when the last step is accepted the task is still in
  // `executing` and has nothing left to verify at the task level.
  executing: ['verifying', 'planning', 'delivering', 'failed', 'cancelled'],
  verifying: ['executing', 'delivering', 'planning', 'failed', 'cancelled'],
  delivering: ['reflecting', 'done', 'failed', 'cancelled'],
  reflecting: ['done', 'failed'],
  paused: [],
  done: [],
  failed: [],
  cancelled: [],
};

const TERMINAL: readonly TaskStatus[] = ['done', 'failed', 'cancelled'];

export interface TransitionRecord {
  from: TaskStatus;
  to: TaskStatus;
  reason: string;
  ts: number;
}

export type TransitionResult =
  | { ok: true; from: TaskStatus; to: TaskStatus; phase: TaskPhase }
  | { ok: false; from: TaskStatus; to: TaskStatus; error: string };

/** Coarse phase shown to the user, derived from status. */
export function phaseOf(status: TaskStatus): TaskPhase {
  switch (status) {
    case 'received':
    case 'clarifying':
    case 'planning':
      return 'planning';
    case 'awaiting-approval':
      return 'awaiting-approval';
    case 'executing':
      return 'executing';
    case 'verifying':
      return 'verifying';
    case 'delivering':
    case 'reflecting':
      return 'delivering';
    case 'paused':
      return 'paused';
    case 'done':
    case 'failed':
    case 'cancelled':
      return 'idle';
  }
}

export function isTerminal(status: TaskStatus): boolean {
  return TERMINAL.includes(status);
}

export class TaskStateMachine {
  private status: TaskStatus;
  private resumeTarget?: TaskStatus;
  private readonly history: TransitionRecord[] = [];

  constructor(initial: TaskStatus = 'received', now: () => number = Date.now) {
    this.status = initial;
    this.history.push({ from: initial, to: initial, reason: 'init', ts: now() });
  }

  get current(): TaskStatus {
    return this.status;
  }

  get isTerminal(): boolean {
    return isTerminal(this.status);
  }

  get isPaused(): boolean {
    return this.status === 'paused';
  }

  /** Where a `resume()` would land. */
  get pausedFrom(): TaskStatus | undefined {
    return this.resumeTarget;
  }

  getHistory(): readonly TransitionRecord[] {
    return this.history;
  }

  canTransition(to: TaskStatus): boolean {
    if (this.status === 'paused') return to === this.resumeTarget || to === 'cancelled' || to === 'failed';
    return TRANSITIONS[this.status].includes(to);
  }

  /**
   * Attempt a transition. Never throws — callers decide how to react to `ok: false`.
   */
  transition(to: TaskStatus, reason = ''): TransitionResult {
    const from = this.status;
    if (!this.canTransition(to)) {
      return {
        ok: false,
        from,
        to,
        error: `Illegal transition ${from} -> ${to}`,
      };
    }
    this.status = to;
    if (to !== 'paused') this.resumeTarget = undefined;
    this.history.push({ from, to, reason, ts: Date.now() });
    return { ok: true, from, to, phase: phaseOf(to) };
  }

  /** Pause from any non-terminal state, remembering where to resume. */
  pause(reason = ''): TransitionResult {
    const from = this.status;
    if (this.isTerminal || from === 'paused') {
      return { ok: false, from, to: 'paused', error: `Cannot pause from ${from}` };
    }
    this.resumeTarget = from;
    this.status = 'paused';
    this.history.push({ from, to: 'paused', reason, ts: Date.now() });
    return { ok: true, from, to: 'paused', phase: phaseOf('paused') };
  }

  /** Resume to the state captured by `pause()`. */
  resume(reason = ''): TransitionResult {
    const from = this.status;
    if (from !== 'paused' || !this.resumeTarget) {
      return { ok: false, from, to: from, error: 'Task is not paused' };
    }
    const to = this.resumeTarget;
    this.resumeTarget = undefined;
    this.status = to;
    this.history.push({ from, to, reason, ts: Date.now() });
    return { ok: true, from, to, phase: phaseOf(to) };
  }

  get phase(): TaskPhase {
    return phaseOf(this.status);
  }

  /** Rehydrate from persisted state (used by `resume(taskId)`). */
  static restore(status: TaskStatus, resumeTarget?: TaskStatus, history?: TransitionRecord[]): TaskStateMachine {
    const sm = new TaskStateMachine(status);
    if (resumeTarget) sm.resumeTarget = resumeTarget;
    if (history) {
      sm.history.length = 0;
      sm.history.push(...history);
    }
    return sm;
  }
}
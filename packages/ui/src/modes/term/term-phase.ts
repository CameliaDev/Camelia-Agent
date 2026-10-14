/**
 * Map an engine task onto the Term timeline.
 *
 * `done` requires a completed task and at least one worker report that succeeded.
 * A local timer must not advance this. A task that finished without a successful
 * worker stays failed.
 * @module
 */

import type { TaskPhase, TaskStatus } from '@camelia/core';

export type TermPhase = 'plan' | 'execute' | 'verify' | 'done' | 'failed';

export interface TermTaskSlice {
  status: TaskStatus;
  phase: TaskPhase;
  subAgents: readonly { status: 'running' | 'ok' | 'error' }[];
}

export function termPhaseFromTask(task: TermTaskSlice | undefined): TermPhase | undefined {
  if (!task) return undefined;
  if (task.status === 'failed' || task.status === 'cancelled') return 'failed';
  if (task.status === 'done') {
    return task.subAgents.some((agent) => agent.status === 'ok') ? 'done' : 'failed';
  }
  if (task.status === 'executing' || task.phase === 'executing') return 'execute';
  if (task.status === 'verifying' || task.phase === 'verifying') return 'verify';
  if (task.status === 'delivering' || task.status === 'reflecting' || task.phase === 'delivering') return 'verify';
  return 'plan';
}

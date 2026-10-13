/**
 * Activity bar — compact task status chip above the run card.
 *
 * ModeHeader already sits once in ChatWorkspace / MathWorkspace, with one drawer toggle.
 * This chip must NOT wrap ModeHeader again.
 * @module
 */

import type { ReactNode } from 'react';

import type { TaskView } from '@camelia/agent/view';

import { t } from '../i18n/strings.js';
import { StatusDot } from './primitives.js';
import { useUiState } from '../state/UiProvider.js';

function taskStatusKey(status: string): Parameters<typeof t>[1] | null {
  const map: Record<string, Parameters<typeof t>[1]> = {
    planning: 'progress.plan.draft',
    'awaiting-approval': 'approval.waiting',
    executing: 'progress.plan.executing',
    verifying: 'progress.plan.executing',
    delivering: 'progress.plan.executing',
    done: 'progress.plan.done',
    failed: 'progress.plan.rejected',
    cancelled: 'progress.plan.rejected',
    paused: 'activity.running',
  };
  return map[status] ?? null;
}

export function ActivityBar({ task }: { task: TaskView }): ReactNode {
  const { localPrefs } = useUiState();
  const tr = (k: Parameters<typeof t>[1]) => t(localPrefs.language, k);
  const running =
    task.status !== 'done' && task.status !== 'failed' && task.status !== 'cancelled' && task.status !== 'paused';
  const statusKey = taskStatusKey(task.status);

  return (
    <div
      data-activity-bar
      className="mb-2 flex shrink-0 items-center gap-1.5 px-0.5 text-[11px] text-ink-2"
    >
      <StatusDot tone={running ? 'ok' : task.status === 'paused' ? 'warn' : 'muted'} pulse={running} />
      {running ? tr('activity.running') : statusKey ? tr(statusKey) : task.status}
    </div>
  );
}

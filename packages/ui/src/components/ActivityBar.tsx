/**
 * Activity bar — the answer to "what is the agent doing right now?".
 *
 * Sits at the top of the conversation and never scrolls away. Everything it shows is
 * derived from event timestamps rather than a wall clock, so the bar is deterministic:
 * replaying the same script yields the same elapsed times, which keeps screenshots and
 * tests stable (whitepaper §6.2).
 *
 * ## One row, from the shared header
 *
 * This used to be two rows — a task line, then a strip of numbered step circles — which
 * made chat's header ≈76px while plan's was ≈33px, so switching modes moved the whole
 * transcript. The strip is now `ModeHeader`: all three modes are 33px, and the numbered
 * circles are gone. The header's lifecycle stepper already says where the task is, and
 * drawing that same axis twice is how two parts of a UI start telling two stories.
 *
 * Pause / steer / cancel were also here, as four props — which is precisely why plan and
 * math had no way to stop a running task: neither renders this component. They are
 * `RunControls` now, right-aligned in the run dock above the composer, not in this header.
 * The task title went too: the header centre shows the session's title (`SessionTitle` in
 * `ModeHeader`) — the durable project name — and drawing the run's own text beside it was
 * the same fact twice. What stays chat-specific is the status dot and label. The inspect
 * toggle that used to sit beside them is gone with the right rail; the panels it opened now
 * hang off the header's own icon row (`PanelIcons`).
 *
 * ## The progress rail is gone from here too
 *
 * This file once rendered a percentage rail, then stopped when `ModeHeader` took it over
 * under exactly the same condition (`topBar === 'hidden'`), so that two call sites could not
 * draw the same source differently. Both copies have since been removed: the top bar's and
 * `ModeHeader`'s. What says where a task is now is the four named lifecycle stops, and how
 * far through it is asked of the run panel's step list — per step, which is more than one
 * number for the whole run ever said.
 * @module
 */

import type { ReactNode } from 'react';

import type { TaskView } from '@camelia/agent/view';

import { t } from '../i18n/strings.js';
import { ModeHeader } from '../modes/ModeHeader.js';
import { StatusDot } from './primitives.js';
import { useUiState } from '../state/UiProvider.js';

export function ActivityBar({ task }: { task: TaskView }): ReactNode {
  const { localPrefs } = useUiState();
  const tr = (k: Parameters<typeof t>[1]) => t(localPrefs.language, k);
  const running =
    task.status !== 'done' && task.status !== 'failed' && task.status !== 'cancelled' && task.status !== 'paused';

  return (
    <ModeHeader
      leading={
        <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-ink-2">
          <StatusDot tone={running ? 'ok' : 'muted'} pulse={running} />
          {running ? tr('activity.running') : task.status}
        </span>
      }
    />
  );
}

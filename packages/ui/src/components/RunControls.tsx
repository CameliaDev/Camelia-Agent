/**
 * Run controls — pause, steer, cancel. One component, drawn once above the composer.
 *
 * ## Why it is shared, and why it sits there
 *
 * These three buttons used to be props on `ActivityBar`, and only chat renders that: plan
 * and math drew their own `ModeHeader` with no `trailing` slot at all. So in two of the three
 * modes a task in flight could not be paused or stopped. They then moved into every mode's
 * header — which fixed the reachability report but left run control 33px from the top of
 * the window, while the run itself is read at the bottom, next to the composer. They are
 * anchored above the composer now, right-aligned in the run dock (`RunDock`) beside the
 * lifecycle stepper, mounted once for every mode: a run is intervened from where the
 * reader already is, and no mode can grow or drop its own copy.
 *
 * They dispatch the same three commands `ActivityBar` always did; nothing about the wire
 * protocol changed.
 *
 * ## Disabled, not hidden
 *
 * Pause and cancel grey out when the task is not in flight instead of disappearing. A
 * vanishing button takes its own space with it, so the header reflows as a task reaches its
 * end — and "the button is gone" reads exactly like "the button is broken", which is the
 * report this component exists to end.
 * @module
 */

import type { ReactNode } from 'react';

import { t } from '../i18n/strings.js';
import { makeCommand } from '../state/store.js';
import { useUiState, useUiStore } from '../state/UiProvider.js';
import { Icon } from './primitives.js';

/**
 * Statuses in which the loop is actually doing something.
 *
 * Spelled out rather than derived from "not one of the four terminal states": `awaiting-
 * approval` is in flight (the agent is waiting on the user, and cancelling it is
 * meaningful), and a new terminal state added later would otherwise be treated as running
 * by default — the wrong direction for a stop button.
 */
const IN_FLIGHT = new Set([
  'received',
  'clarifying',
  'planning',
  'awaiting-approval',
  'executing',
  'verifying',
  'delivering',
  'reflecting',
]);

const ICON_BUTTON =
  'grid h-6 w-6 shrink-0 place-items-center rounded text-ink-3 transition-colors hover:bg-hover hover:text-ink disabled:opacity-40';

export function RunControls(): ReactNode {
  const { snapshot, dispatch } = useUiState();
  const language = useUiStore((s) => s.localPrefs.language);
  const steeringOpen = useUiStore((s) => s.steeringOpen);
  const setSteeringOpen = useUiStore((s) => s.setSteeringOpen);
  const tr = (k: Parameters<typeof t>[1]) => t(language, k);
  const task = snapshot.task;

  // No task, no run to control. The stepper leaves its slot blank for the same reason.
  if (!task) return null;

  const paused = task.status === 'paused';
  const live = IN_FLIGHT.has(task.status);

  return (
    <span data-run-controls className="flex shrink-0 items-center gap-1">
      {paused ? (
        <button
          type="button"
          data-run-resume
          aria-label={tr('resume')}
          title={tr('resume')}
          className={ICON_BUTTON}
          onClick={() => dispatch(makeCommand('resume_task', { taskId: task.id }))}
        >
          <Icon name="play" size={12} />
        </button>
      ) : (
        <button
          type="button"
          data-run-pause
          aria-label={tr('pause')}
          title={tr('pause')}
          disabled={!live}
          className={ICON_BUTTON}
          onClick={() => dispatch(makeCommand('pause_task', { taskId: task.id, reason: 'user paused' }))}
        >
          <Icon name="pause" size={12} />
        </button>
      )}

      {/*
        Steer opens the shared form rather than dispatching anything: it needs a sentence of
        intent, and the form lives with the composer so it is the same panel in every mode.
      */}
      <button
        type="button"
        data-run-steer
        aria-label={tr('steer')}
        aria-pressed={steeringOpen}
        title={tr('steer')}
        className={`${ICON_BUTTON} ${steeringOpen ? 'bg-hover text-ink' : ''}`}
        onClick={() => setSteeringOpen(!steeringOpen)}
      >
        <Icon name="compass" size={12} />
      </button>

      <button
        type="button"
        data-run-cancel
        aria-label={tr('cancel')}
        title={tr('cancel')}
        disabled={!live}
        className={`${ICON_BUTTON} hover:bg-bad hover:text-white`}
        onClick={() => dispatch(makeCommand('cancel_task', { taskId: task.id, reason: 'user cancelled' }))}
      >
        <Icon name="stop" size={12} />
      </button>
    </span>
  );
}
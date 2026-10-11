/**
 * Activity bar — the answer to "what is the agent doing right now?".
 *
 * Sits at the top of the conversation and never scrolls away. Everything it shows is
 * derived from event timestamps rather than a wall clock, so the bar is deterministic:
 * replaying the same script yields the same elapsed times, which keeps screenshots and
 * tests stable (whitepaper §6.2).
 * @module
 */

import type { ReactNode } from 'react';

import type { TaskView } from '@camelia/agent/view';

import { ms, pct } from '../lib/format.js';
import { ACTIVITY_META, TONE_TEXT } from '../lib/status.js';
import { t } from '../i18n/strings.js';
import { Chip, Icon, ProgressBar, StatusDot } from './primitives.js';
import { useUiState, useUiStore } from '../state/UiProvider.js';

export function ActivityBar({
  task,
  onPause,
  onResume,
  onCancel,
  onIntervene,
}: {
  task: TaskView;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onIntervene: () => void;
}): ReactNode {
  const { localPrefs } = useUiState();
  const setLocalPrefs = useUiStore((s) => s.setLocalPrefs);
  const rightCollapsed = localPrefs.rightCollapsed;
  const tr = (k: Parameters<typeof t>[1]) => t(localPrefs.language, k);
  const meta = ACTIVITY_META[task.activity.kind];
  const label = task.activity.kind === 'waiting-approval' ? tr('approval.waiting') : meta.label;
  const elapsed = Math.max(0, task.updatedAt - task.startedAt);
  const inActivity = Math.max(0, task.updatedAt - task.activity.since);
  const running = task.status !== 'done' && task.status !== 'failed' && task.status !== 'cancelled' && task.status !== 'paused';
  const waiting = task.activity.kind === 'waiting-approval';

  return (
    <div className="sticky top-0 z-10 border-b border-line bg-base/95 px-4 py-2 backdrop-blur">
      <div className="flex items-center gap-2.5">
        <span
          data-activity={task.activity.kind}
          data-task-status={task.status}
          className={`flex items-center gap-1.5 text-[12px] font-semibold ${TONE_TEXT[meta.tone]}`}
        >
          {running ? <StatusDot tone={meta.tone} pulse /> : <Icon name="dot" size={10} />}
          {label}
        </span>
        <span className="min-w-0 flex-1 truncate text-[12px] text-ink-2">{task.activity.detail}</span>

        <span className="hidden shrink-0 items-center gap-1 font-mono text-[10.5px] text-ink-3 sm:flex">
          <Icon name="clock" size={11} />
          {ms(elapsed)} total · {ms(inActivity)} here
        </span>

        <div className="flex shrink-0 items-center gap-1.5">
          {rightCollapsed ? (
            <button
              type="button"
              data-open-right-rail
              aria-label={tr('right.expand')}
              title={tr('right.expand')}
              className="inline-flex items-center gap-1 rounded border border-line px-2 py-[3px] text-[11px] text-ink-2 hover:border-accent/40 hover:text-accent"
              onClick={() => setLocalPrefs({ rightCollapsed: false })}
            >
              <Icon name="gauge" size={11} />
              {tr('right.inspect')}
            </button>
          ) : null}
          {waiting ? <Chip tone="warn">{tr('approval.yourCall')}</Chip> : null}
          {task.status === 'paused' ? (
            <button
              type="button"
              onClick={onResume}
              className="inline-flex items-center gap-1 rounded border border-accent/40 px-2 py-[3px] text-[11px] text-accent hover:bg-accent/10"
            >
              <Icon name="play" size={11} />
              {tr('resume')}
            </button>
          ) : (
            <button
              type="button"
              onClick={onPause}
              disabled={!running}
              className="inline-flex items-center gap-1 rounded border border-line px-2 py-[3px] text-[11px] text-ink-2 hover:border-accent/40 hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Icon name="pause" size={11} />
              {tr('pause')}
            </button>
          )}
          <button
            type="button"
            onClick={onIntervene}
            className="inline-flex items-center gap-1 rounded border border-line px-2 py-[3px] text-[11px] text-ink-2 hover:border-info/40 hover:text-info"
          >
            <Icon name="compass" size={11} />
            {tr('steer')}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={!running}
            className="inline-flex items-center gap-1 rounded border border-line px-2 py-[3px] text-[11px] text-ink-2 hover:border-bad/40 hover:text-bad disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Icon name="stop" size={11} />
            {tr('cancel')}
          </button>
        </div>
      </div>

      <div className="mt-2 flex items-center gap-2.5">
        <ProgressBar value={task.progress} tone={task.status === 'failed' ? 'bad' : task.status === 'done' ? 'ok' : 'accent'} />
        <span className="shrink-0 font-mono text-[10.5px] text-ink-3">{pct(task.progress)}</span>
        <span className="shrink-0 font-mono text-[10.5px] text-ink-3">
          step {Math.min(task.currentStepIdx + 1, Math.max(1, task.stepsTotal))}/{task.stepsTotal || '—'}
        </span>
      </div>
    </div>
  );
}
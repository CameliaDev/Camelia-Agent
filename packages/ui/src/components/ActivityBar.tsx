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

import { localizePlanText } from '../i18n/plan-copy.js';
import { deriveProgress } from '../progress/deriveProgress.js';
import { TaskProgressBar, ProgressMicrocopy } from '../progress/TaskProgressBar.js';
import { useMode } from '../mode/useMode.js';
import { t } from '../i18n/strings.js';
import { rightRailUserPatch } from '../state/local-prefs.js';
import { Icon, StatusDot } from './primitives.js';
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
  const { localPrefs, mathDemo } = useUiState();
  const setLocalPrefs = useUiStore((s) => s.setLocalPrefs);
  const rightCollapsed = localPrefs.rightCollapsed;
  const { mode } = useMode();
  // Same derivation as the top bar — never a second calculation. The rail is rendered here
  // *only* when the top bar cannot show it (user set `topBar: 'hidden'`), because
  // duplicating the bar in both places is the "double source" failure this codebase avoids.
  const progress = deriveProgress({ task, mode, language: localPrefs.language, ...(mathDemo ? { mathDemo } : {}) });
  const topBarCarriesProgress = localPrefs.topBar !== 'hidden';
  const tr = (k: Parameters<typeof t>[1], params?: Parameters<typeof t>[2]) => t(localPrefs.language, k, params);
  const running = task.status !== 'done' && task.status !== 'failed' && task.status !== 'cancelled' && task.status !== 'paused';

  return (
    <div className="sticky top-0 z-10 border-b border-line bg-base px-4 py-2.5">
      {/* 第一行：任务标题 + 运行状态 + 数据详情标签 */}
      <div className="flex items-center gap-2.5">
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink" data-task-title>
          任务：{task.intentRaw || task.goal || task.activity.detail}
        </span>

        <span className="flex shrink-0 items-center gap-1.5 text-[11.5px] text-ink-2">
          <StatusDot tone={running ? 'ok' : 'muted'} pulse={running} />
          {running ? tr('activity.running') : task.status} · {tr('progress.step', { current: Math.min(task.currentStepIdx + 1, Math.max(1, task.stepsTotal)), total: task.stepsTotal || '—' })}
        </span>

        {/* Only when the top bar is fully hidden: otherwise it already carries this rail. */}
        {!topBarCarriesProgress ? (
          <span className="flex w-24 shrink-0 items-center gap-1.5" data-activity-progress>
            <TaskProgressBar result={progress} />
            <ProgressMicrocopy result={progress} language={localPrefs.language} />
          </span>
        ) : null}

        {rightCollapsed ? (
          <button
            type="button"
            data-open-right-rail
            aria-label={tr('right.expand')}
            title={tr('right.expand')}
            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-2 py-[2px] text-[11px] font-medium text-accent hover:bg-accent/15"
            onClick={() => setLocalPrefs(rightRailUserPatch(false))}
          >
            {tr('right.inspect')}
            <Icon name="x" size={10} />
          </button>
        ) : (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-2 py-[2px] text-[11px] font-medium text-accent">
            {tr('right.inspect')}
            <button type="button" aria-label={tr('right.collapse')} onClick={() => setLocalPrefs(rightRailUserPatch(true))}>
              <Icon name="x" size={10} />
            </button>
          </span>
        )}

        {/* 暂停/继续/引导/取消（轻量图标按钮） */}
        <div className="flex shrink-0 items-center gap-1">
          {task.status === 'paused' ? (
            <button type="button" onClick={onResume} title={tr('resume')} className="grid h-6 w-6 place-items-center rounded text-ink-3 hover:bg-hover hover:text-ink">
              <Icon name="play" size={12} />
            </button>
          ) : (
            <button type="button" onClick={onPause} disabled={!running} title={tr('pause')} className="grid h-6 w-6 place-items-center rounded text-ink-3 hover:bg-hover hover:text-ink disabled:opacity-40">
              <Icon name="pause" size={12} />
            </button>
          )}
          <button type="button" onClick={onIntervene} title={tr('steer')} className="grid h-6 w-6 place-items-center rounded text-ink-3 hover:bg-hover hover:text-ink">
            <Icon name="compass" size={12} />
          </button>
          <button type="button" onClick={onCancel} disabled={!running} title={tr('cancel')} className="grid h-6 w-6 place-items-center rounded text-ink-3 hover:bg-bad hover:text-white disabled:opacity-40">
            <Icon name="stop" size={12} />
          </button>
        </div>
      </div>

      {/* 第二行：步骤圆圈条 */}
      {task.steps.length > 0 ? (
        <ol className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {task.steps.map((step) => {
            const cls =
              step.status === 'done'
                ? 'done'
                : step.idx === task.currentStepIdx && (step.status === 'running' || step.status === 'verifying')
                  ? 'active'
                  : '';
            return (
              <li key={step.id} className="flex items-center gap-1.5">
                <span className={`wf-step-circle ${cls}`}>{step.idx + 1}</span>
                <span className={`text-[11.5px] ${cls === 'active' ? 'text-ink font-medium' : step.status === 'done' ? 'text-ink-2' : 'text-ink-3'}`}>
                  {localizePlanText(localPrefs.language, step.title)}
                </span>
              </li>
            );
          })}
        </ol>
      ) : null}
    </div>
  );
}
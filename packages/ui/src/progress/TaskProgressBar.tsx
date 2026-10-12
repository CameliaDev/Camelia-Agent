/**
 * The top bar's progress readout — a 2px rail plus one short line of copy.
 *
 * It renders whatever `deriveProgress` returned, and knows nothing about tasks, steps or
 * math pipelines. That separation is what keeps the top bar and the activity bar from
 * disagreeing: there is exactly one derivation, and this is a dumb renderer for it.
 *
 * When there is nothing to report the rail stays in the DOM at 0% and very low contrast
 * rather than disappearing — a bar that pops in and out reflows the whole header on every
 * task start, which is exactly the kind of jumpiness the top bar rework is meant to fix.
 * @module
 */

import type { ReactNode } from 'react';

import { TONE_DOT } from '../lib/status.js';
import { MATH_STAGES } from '../modes/math/mathStageMap.js';
import { t } from '../i18n/strings.js';
import type { LanguagePref } from '../state/local-prefs.js';
import { type ProgressResult } from '../progress/types.js';

/** Statuses that mean the rail should read as "at rest" rather than "in flight". */
function isIdle(status: string): boolean {
  return status === 'idle';
}

export function TaskProgressBar({ result }: { result: ProgressResult }): ReactNode {
  const { progress } = result;
  const ratio = progress.kind === 'math' ? progress.overall : progress.ratio;
  const clamped = Math.max(0, Math.min(1, ratio));
  const idle = progress.kind === 'task' ? isIdle(progress.status) : progress.kind === 'math' ? isIdle(progress.status) : false;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-[3px]" data-progress-bar data-progress-kind={progress.kind}>
      <div
        className="h-[2px] w-full overflow-hidden rounded-full bg-line/70"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(clamped * 100)}
        aria-valuetext={String(Math.round(clamped * 100))}
      >
        <div
          className={`h-full rounded-full transition-[width] duration-500 ${idle ? 'bg-ink-3/25' : TONE_DOT[progress.tone]}`}
          style={{ width: `${clamped * 100}%` }}
        />
      </div>
    </div>
  );
}

/**
 * The one-line explanatory copy that sits beside the rail.
 *
 * Split out so the top bar can place it independently (it is dropped first when the
 * window is narrow, keeping the rail itself always visible).
 */
export function ProgressMicrocopy({ result, language }: { result: ProgressResult; language: LanguagePref }): ReactNode {
  const tr = (k: Parameters<typeof t>[1], params?: Parameters<typeof t>[2]) => t(language, k, params);
  const { progress } = result;

  if (result.demo) {
    // The demo badge is part of this line on purpose: it must travel with the numbers.
    return (
      <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-ink-2" data-progress-copy>
        <span className="rounded border border-warn/50 bg-warn/10 px-[5px] py-[1px] text-[10px] font-medium text-warn">
          {tr('math.demo.badge')}
        </span>
        <span className="truncate">{stageLabel(progress.kind === 'math' ? progress.stage : 'modeling', tr)}</span>
      </span>
    );
  }

  if (progress.kind === 'task') {
    if (progress.status === 'idle' || progress.total === 0) {
      return (
        <span className="shrink-0 text-[11px] text-ink-3" data-progress-copy>
          {tr('progress.idle')}
        </span>
      );
    }
    return (
      <span className="min-w-0 truncate text-[11px] text-ink-2" data-progress-copy>
        {tr('progress.step', { current: progress.current, total: progress.total })}
        {progress.label ? ` · ${progress.label}` : ''}
      </span>
    );
  }

  if (progress.kind === 'plan') {
    // Reuse the existing approval copy rather than inventing a second word for the same
    // state — `approval.waiting` already means "the plan needs your call".
    const key: Parameters<typeof t>[1] =
      progress.stage === 'awaiting_approval'
        ? 'approval.waiting'
        : progress.stage === 'executing'
          ? 'progress.plan.executing'
          : progress.stage === 'done'
            ? 'progress.plan.done'
            : progress.stage === 'rejected'
              ? 'progress.plan.rejected'
              : 'progress.plan.draft';
    return (
      <span className="shrink-0 text-[11px] text-ink-2" data-progress-copy>
        {tr(key)}
      </span>
    );
  }

  return (
    <span className="min-w-0 truncate text-[11px] text-ink-2" data-progress-copy>
      {stageLabel(progress.stage, tr)}
      <span className="text-ink-3"> · {Math.round(progress.ratio * 100)}%</span>
    </span>
  );
}

function stageLabel(stage: (typeof MATH_STAGES)[number]['id'], tr: (k: Parameters<typeof t>[1]) => string): string {
  const spec = MATH_STAGES.find((s) => s.id === stage) ?? MATH_STAGES[0]!;
  return tr(spec.labelKey as Parameters<typeof t>[1]);
}

/**
 * Plan mode.
 *
 * The plan *is* the work area here: the review surface sits in the centre column with the
 * plan's lifecycle above it, instead of being a tab hidden inside the conversation.
 *
 * Nothing about approval is new — `approve_plan` / `reject_plan` / `edit_plan` /
 * `set_plan_approval` are all already handled by the engine (`EngineServer`), and
 * `PlanReview` already issues them. This workspace changes where the surface *lives* and
 * makes the lifecycle legible, which is the part that was missing.
 *
 * Above the review, a lifecycle strip reads the same `deriveProgress` the top bar uses, so
 * "待批准" can never appear in one place and "执行中" in another.
 * @module
 */

import { type ReactNode } from 'react';

import { t } from '../../i18n/strings.js';
import { deriveProgress } from '../../progress/deriveProgress.js';
import { useUiState, useUiStore } from '../../state/UiProvider.js';
import { PlanReview } from '../../components/PlanReview.js';
import { Icon, LoadingState } from '../../components/primitives.js';
import type { PlanStage } from '../../progress/types.js';
import { TONE_TEXT } from '../../lib/status.js';

/** The four lifecycle stops, in order — the same axis `deriveProgress` maps onto. */
const STOPS: readonly { stage: PlanStage; labelKey: string }[] = [
  { stage: 'draft', labelKey: 'progress.plan.draft' },
  { stage: 'awaiting_approval', labelKey: 'approval.waiting' },
  { stage: 'executing', labelKey: 'progress.plan.executing' },
  { stage: 'done', labelKey: 'progress.plan.done' },
];

export function PlanWorkspace(): ReactNode {
  const { snapshot } = useUiState();
  const language = useUiStore((s) => s.localPrefs.language);
  const tr = (k: Parameters<typeof t>[1]) => t(language, k);
  const task = snapshot.task;

  if (!task) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-8 py-10 text-center" data-plan-empty>
        <Icon name="compass" size={22} className="text-ink-3" />
        <p className="mt-3 text-[13px] font-medium text-ink">{tr('progress.plan.draft')}</p>
        <p className="mt-1 max-w-sm text-[12px] leading-6 text-ink-3">
          提交一个任务后，这里会显示计划步骤，你可以在任何步骤执行前审阅、调整或拒绝。
        </p>
      </div>
    );
  }

  const { progress } = deriveProgress({ task, mode: 'plan', language });
  const stage: PlanStage = progress.kind === 'plan' ? progress.stage : 'draft';
  const activeIdx = STOPS.findIndex((s) => s.stage === stage);
  // `rejected` is terminal but off the happy path — show it as a failure tone.
  const rejected = stage === 'rejected';
  const tone = progress.kind === 'plan' ? progress.tone : 'muted';

  if (task.phase === 'idle' && task.steps.length === 0 && task.status === 'received') {
    return <LoadingState label={tr('progress.plan.draft')} />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-plan-workspace>
      <div className="shrink-0 border-b border-line px-4 py-2">
        <ol className="flex flex-wrap items-center gap-x-2 gap-y-1" data-plan-lifecycle>
          {STOPS.map((stop, idx) => {
            const reached = !rejected && activeIdx >= idx;
            const current = !rejected && activeIdx === idx;
            return (
              <li key={stop.stage} className="flex items-center gap-2">
                <span
                  data-plan-stop={stop.stage}
                  data-plan-current={current ? 'true' : undefined}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-[2px] text-[11px] ${
                    current
                      ? `${TONE_TEXT[tone]} border-current/40 bg-current/10`
                      : reached
                        ? 'border-line text-ink-2'
                        : 'border-line/60 text-ink-3/70'
                  }`}
                >
                  {reached && !current ? <Icon name="check" size={10} /> : null}
                  {tr(stop.labelKey as Parameters<typeof t>[1])}
                </span>
                {idx < STOPS.length - 1 ? <span className="text-[10px] text-ink-3/50">→</span> : null}
              </li>
            );
          })}
          {rejected ? (
            <li>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-bad/40 bg-bad/10 px-2 py-[2px] text-[11px] text-bad">
                {tr('progress.plan.rejected')}
              </span>
            </li>
          ) : null}
        </ol>
      </div>

      {/* The review surface. It already knows how to render every step state and how to
          issue the approval commands; plan mode only decides that it is the primary
          surface rather than a tab. */}
      <PlanReview task={task} />
    </div>
  );
}

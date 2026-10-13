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
 * The lifecycle strip is now `ModeHeader`'s, not this file's: chat, plan and math all
 * draw the same 33px bar so switching modes does not move the content.
 * @module
 */

import { type ReactNode } from 'react';

import { t } from '../../i18n/strings.js';
import { useUiState, useUiStore } from '../../state/UiProvider.js';
import { PlanReview } from '../../components/PlanReview.js';
import { ModeHeader } from '../ModeHeader.js';
import { Icon, LoadingState } from '../../components/primitives.js';

export function PlanWorkspace(): ReactNode {
  const { snapshot } = useUiState();
  const language = useUiStore((s) => s.localPrefs.language);
  const tr = (k: Parameters<typeof t>[1]) => t(language, k);
  const task = snapshot.task;

  // The strip is rendered *before* the empty/loading branches, not inside the main
  // return. Otherwise an empty plan workspace would have no header at all while math
  // still did, and switching to plan would jump the content up by 33px — the exact
  // drift the shared header exists to prevent. Every mode owns one strip, always.
  const header = (
    <ModeHeader
      leading={<span className="shrink-0 text-[11.5px] font-medium text-ink">{tr('mode.plan')}</span>}
    />
  );

  if (!task) {
    return (
      <div className="flex min-h-0 flex-1 flex-col" data-plan-workspace>
        {header}
        <div className="flex flex-1 flex-col items-center justify-center px-8 py-10 text-center" data-plan-empty>
          <Icon name="compass" size={22} className="text-ink-3" />
          <p className="mt-3 text-[13px] font-medium text-ink">{tr('progress.plan.draft')}</p>
          <p className="mt-1 max-w-sm text-[12px] leading-6 text-ink-3">
            提交一个任务后，这里会显示计划步骤，你可以在任何步骤执行前审阅、调整或拒绝。
          </p>
        </div>
      </div>
    );
  }

  if (task.phase === 'idle' && task.steps.length === 0 && task.status === 'received') {
    return (
      <div className="flex min-h-0 flex-1 flex-col" data-plan-workspace>
        {header}
        <LoadingState label={tr('progress.plan.draft')} />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-plan-workspace>
      {/*
        The lifecycle strip now comes from `ModeHeader`, so plan and chat and math all
        draw one 33px bar. The stops used to be rendered here inline, which is what made
        this mode's header a different height from the other two.
      */}
      {header}

      {/* The review surface. It already knows how to render every step state and how to
          issue the approval commands; plan mode only decides that it is the primary
          surface rather than a tab. */}
      <PlanReview task={task} />

      {/* Final delivery: when the task is done, show the summary and artifacts here too,
          otherwise a user who stays in plan mode never sees the agent's reply. */}
      {task.status === 'done' && task.summary ? (
        <div className="shrink-0 border-t border-line px-4 py-3" data-plan-delivery>
          <div className="flex items-center gap-2">
            <Icon name="check" size={14} className="text-ok" />
            <span className="text-[12.5px] font-semibold text-ok">{tr('delivery.delivered')}</span>
          </div>
          <p className="mt-2 text-[12px] leading-6 text-ink-2">{task.summary}</p>
          {task.artifacts.length ? (
            <ul className="mt-2 space-y-1">
              {task.artifacts.map((a) => (
                <li key={a.path} className="font-mono text-[11px] text-ink-3">· {a.path}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

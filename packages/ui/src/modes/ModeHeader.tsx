/**
 * Mode header — the one strip every mode shares.
 *
 * ## Why this exists
 *
 * Chat, plan and math each used to draw their own top strip inline. They were never the
 * same strip: chat rendered `ActivityBar` (a task line plus a second row of numbered step
 * circles, ≈76px), plan rendered its lifecycle pills (≈33px), math rendered stage chips
 * with a trailing button group (≈37px). The heights therefore differed by more than 2×
 * between modes, and switching modes moved the whole transcript up or down — which is
 * exactly what "the three modes do not line up" meant.
 *
 * The strip is one strip. It has one height (`MODE_HEADER_H`), and each mode supplies only
 * the content that differs. A mode that wants a taller header is a mode that has not
 * decided what belongs there yet.
 *
 * ## It renders on every path, empty states included
 *
 * The height is an invariant of the shell, not of having work to show. Chat and plan both
 * used to `return` their empty or loading state *before* reaching the header, so an idle
 * window had a 33px strip in math and none in chat or plan — which made the first mode
 * switch a new user ever makes move the whole column. The header is therefore built once
 * and placed on each branch; an early return has to carry it rather than skip it.
 *
 * ## The stepper
 *
 * Every mode shows the same four stops — `起草中 → 等待你的审批 → 执行中 → 已完成`. That is
 * deliberate rather than decorative: the stops are the plan lifecycle, and they are the
 * same lifecycle in all three modes (`deriveProgress` maps chat's weighted progress and
 * plan's `task.status` onto this one axis). Chat used to draw the same information a
 * second way, as numbered circles per step; two renderings of one axis is how a UI starts
 * telling two stories. The stepper uses `planStageOf` for the axis in every mode, because
 * the *question* it answers ("where is this task in its lifecycle?") does not change when
 * the workspace does.
 *
 * The stop set is only drawn when there is a task. With no task there is no lifecycle, and
 * four empty pills would claim otherwise — so the slot is left blank and the header shows
 * only whatever the mode put in its leading slot.
 *
 * (2026-10: the stepper moved out of this strip — it now sits centred in the run dock
 * directly above the composer, beside the run controls, because the run is read and
 * intervened at the bottom of the window. The centre of this strip shows the session's
 * title instead: the one fact about the workspace that does not change mid-run.
 * @module
 */

import type { ReactNode } from 'react';

import { TONE_TEXT } from '../lib/status.js';
import { t } from '../i18n/strings.js';
import { planStageOf } from '../progress/deriveProgress.js';
import type { PlanStage, ProgressTone } from '../progress/types.js';
import { useUiStore } from '../state/UiProvider.js';
import { Icon } from '../components/primitives.js';

/**
 * The fixed strip height, in px.
 *
 * Shared with `--mode-header-h` so the activity bar's sticky offset and any future
 * measurement read the same number instead of a second literal. 33px is one line of 11px
 * text with `py-2` and the 1px bottom border, which is what the plan strip already
 * measured — keeping it means the modes that were already right do not move.
 */
export const MODE_HEADER_H = 33;

/** The four lifecycle stops, in order — the same axis `deriveProgress` maps onto. */
const STOPS: readonly { stage: PlanStage; labelKey: Parameters<typeof t>[1] }[] = [
  { stage: 'draft', labelKey: 'progress.plan.draft' },
  { stage: 'awaiting_approval', labelKey: 'approval.waiting' },
  { stage: 'executing', labelKey: 'progress.plan.executing' },
  { stage: 'done', labelKey: 'progress.plan.done' },
];

/**
 * The lifecycle stepper.
 *
 * Reads `planStageOf` rather than the mode-specific projection: the stops are the plan
 * axis in every mode, so a task that is executing reads "执行中" whether the user is
 * looking at chat, plan or math.
 */
export function LifecycleStepper({ compact }: { compact?: boolean }): ReactNode {
  const language = useUiStore((s) => s.localPrefs.language);
  const task = useUiStore((s) => s.snapshot.task);
  const tr = (k: Parameters<typeof t>[1]) => t(language, k);

  if (!task) return null;

  const stage = planStageOf(task);
  const rejected = stage === 'rejected';
  const activeIdx = STOPS.findIndex((s) => s.stage === stage);
  const PLAN_TONE: Record<PlanStage, ProgressTone> = {
    draft: 'muted',
    awaiting_approval: 'warn',
    executing: 'info',
    done: 'ok',
    rejected: 'bad',
  };
  const tone = PLAN_TONE[stage];

  return (
    <ol className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1" data-plan-lifecycle>
      {STOPS.map((stop, idx) => {
        const reached = !rejected && activeIdx >= idx;
        const current = !rejected && activeIdx === idx;
        return (
          <li key={stop.stage} className="flex items-center gap-2">
            <span
              data-plan-stop={stop.stage}
              data-plan-current={current ? 'true' : undefined}
              className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-[7px] py-[1px] text-[11px] leading-4 ${
                current
                  ? `${TONE_TEXT[tone]} border-current/40 bg-current/10`
                  : reached
                    ? 'border-line text-ink-2'
                    : 'border-line/60 text-ink-3/70'
              }`}
            >
              {reached && !current ? <Icon name="check" size={10} /> : null}
              {tr(stop.labelKey)}
            </span>
            {idx < STOPS.length - 1 ? (
              <span className={compact ? 'text-[9px] text-ink-3/50' : 'text-[10px] text-ink-3/50'}>→</span>
            ) : null}
          </li>
        );
      })}
      {rejected ? (
        <li>
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-bad/40 bg-bad/10 px-[7px] py-[1px] text-[11px] leading-4 text-bad">
            {tr('progress.plan.rejected')}
          </span>
        </li>
      ) : null}
    </ol>
  );
}

/**
 * The session's title — "which project am I in".
 *
 * The strip used to centre the lifecycle stepper here; the stepper moved to the run dock
 * above the composer (`RunDock`), and the centre now carries the durable name of the chat
 * session this workspace is showing. Chat's own task title went with it — the session
 * title is the durable name, and drawing the run's own text beside it was the same fact
 * twice.
 */
/**
 * The shared strip.
 *
 * `leading` is the mode's own content (a task title, a stage hint, a demo badge) and
 * `trailing` is its control group. Everything else — the height, the border, the
 * horizontal padding, the stepper — comes from here, so a mode cannot drift.
 *
 * ## There is no progress rail here
 *
 * This strip used to carry `TaskProgressBar` + `ProgressMicrocopy` conditionally: only when
 * `topBar === 'hidden'`, because the top bar owned the rail otherwise and two rails from one
 * source is two chances to draw it differently. Both are gone now — the top bar's copy was
 * removed outright, and with it the only reason this one existed.
 *
 * So the strip answers *which stage* and nothing else. That is a deliberate loss, not an
 * oversight: a 33px strip is room for four named stops, and a continuous percentage next to
 * them competes with them. Where a reader wants "how far through", the run panel's step list
 * says it per step, which is strictly more informative than one number for the whole run.
 */
export function ModeHeader({
  leading,
  trailing,
}: {
  leading?: ReactNode;
  trailing?: ReactNode;
}): ReactNode {
  if (!leading && !trailing) return null;
  return (
    <div
      data-mode-header
      style={{ height: MODE_HEADER_H }}
      className="flex shrink-0 items-center gap-2.5 overflow-hidden bg-base px-4"
    >
      {leading}
      <div className="min-w-0 flex-1" />
      {trailing}
    </div>
  );
}

/**
 * Saved Work plan / goal notes.
 *
 * Scaffold only: these rows are `work.plan_saved` folds, not task-machine steps.
 * An empty list invites a save. It does not claim that no plans exist.
 * @module
 */

import type { ReactNode } from 'react';

import type { WorkPlanView } from '@camelia/agent/view';

import { t } from '../../i18n/strings.js';
import { useUiStore } from '../../state/UiProvider.js';

export function WorkPlanList({ plans }: { plans: readonly WorkPlanView[] }): ReactNode {
  const language = useUiStore((s) => s.localPrefs.language);
  const tr = (k: Parameters<typeof t>[1]) => t(language, k);

  if (plans.length === 0) {
    return (
      <p className="max-w-sm text-center text-[13px] leading-5 text-ink-3" data-work-plan-empty>
        {tr('work.plan.empty')}
      </p>
    );
  }

  return (
    <ul className="mt-3 w-full max-w-md space-y-1.5 text-left" data-work-plans>
      <li className="text-[10.5px] font-medium uppercase tracking-[0.06em] text-ink-3">{tr('work.plan.saved')}</li>
      {plans.map((plan) => (
        <li
          key={plan.id}
          data-work-plan={plan.id}
          data-work-plan-mode={plan.mode}
          className="rounded-lg border border-line bg-elevated/60 px-3 py-2"
        >
          <p className="text-[12.5px] font-medium text-ink">{plan.title}</p>
          <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-5 text-ink-3">{plan.goal}</p>
        </li>
      ))}
    </ul>
  );
}

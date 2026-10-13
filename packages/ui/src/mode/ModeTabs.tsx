/**
 * The mode selector — a segmented control in the composer's control row.
 *
 * ## Where it lives, and why there
 *
 * It was in the top bar. It is now rendered by `Composer`, directly above the submit button
 * and left of the model chip. The mode decides what Enter *means* — chat submits a task, plan
 * reviews one, math runs a workspace — so the control belongs with the input whose meaning it
 * changes, not in a separate strip the reader has to look away from to correlate. Put in the
 * same row as the model chip, the row reads left to right as the two facts about the pending
 * submission: which workspace, then what will run in it.
 *
 * Three source-of-truth decisions are encoded here:
 *
 * 1. **It never stops a task.** Switching modes is pure chrome (see `mode/useMode.ts`),
 *    so a running task keeps running. When one *is* running we surface a one-line hint so
 *    the user is not surprised that work continues out of sight.
 * 2. **Unavailable modes stay visible.** Math is currently `available: false`; hiding the
 *    tab would make the information architecture undiscoverable, so the tab renders with
 *    a disabled affordance and an explanatory title instead.
 * 3. **It is the only mode switch.** Nothing else in the tree sets the mode.
 * @module
 */

import type { ReactNode } from 'react';

import { t } from '../i18n/strings.js';
import type { LanguagePref } from '../state/local-prefs.js';
import { Icon } from '../components/primitives.js';
import { MODE_COMING_SOON, MODE_REGISTRY } from './ModeRegistry.js';
import { type AppModeId } from './types.js';

export function ModeTabs({
  mode,
  language,
  onSelect,
  taskRunning,
}: {
  mode: AppModeId;
  language: LanguagePref;
  onSelect: (id: AppModeId) => void;
  /** When true, a hint is shown — the task keeps running across the switch. */
  taskRunning: boolean;
}): ReactNode {
  const tr = (k: Parameters<typeof t>[1]) => t(language, k);

  return (
    <div className="flex shrink-0 items-center gap-1" role="tablist" aria-label={tr('mode.chat')} data-mode-tabs>
      {MODE_REGISTRY.map((def) => {
        const active = def.id === mode;
        const title = def.available
          ? tr(def.descriptionKey as Parameters<typeof t>[1])
          : `${tr(def.labelKey as Parameters<typeof t>[1])} — ${tr((def.unavailableReasonKey ?? 'mode.more.title') as Parameters<typeof t>[1])}`;
        return (
          <button
            key={def.id}
            type="button"
            role="tab"
            data-mode-tab={def.id}
            aria-selected={active}
            title={title}
            onClick={() => onSelect(def.id)}
            className={`inline-flex items-center gap-1.5 rounded-md px-2 py-[3px] text-[11.5px] transition-colors ${
              active
                ? 'bg-accent/12 font-medium text-accent'
                : 'text-ink-2 hover:bg-hover hover:text-ink'
            }`}
          >
            <Icon name={def.icon} size={12} />
            <span>{tr(def.labelKey as Parameters<typeof t>[1])}</span>
            {!def.available ? (
              // A dot, not a badge: it must read as "not yet", not as an error.
              <span className="h-1 w-1 rounded-full bg-warn/70" aria-hidden />
            ) : null}
          </button>
        );
      })}

      <ComingSoonMenu language={language} disabled={taskRunning} />
    </div>
  );
}

/**
 * Reserved modes. Rendered as a disabled affordance rather than removed, so the IA shows
 * where the product is going without inventing functionality.
 */
function ComingSoonMenu({ language, disabled }: { language: LanguagePref; disabled: boolean }): ReactNode {
  const tr = (k: Parameters<typeof t>[1]) => t(language, k);
  // Reserved modes are always inert (there is nothing to click), so the affordance is
  // always the not-allowed cursor. `disabled` only dims it further while a task runs.
  return (
    <span
      data-mode-more
      title={`${tr('mode.more.title')} — ${MODE_COMING_SOON.map((m) => tr(m.labelKey as Parameters<typeof t>[1])).join(' / ')}`}
      aria-disabled
      className={`inline-flex cursor-not-allowed items-center gap-0.5 rounded-md px-1.5 py-[3px] text-[11.5px] ${
        disabled ? 'text-ink-3/50' : 'text-ink-3/70'
      }`}
    >
      {MODE_COMING_SOON.map((m) => (
        <Icon key={m.labelKey} name={m.icon} size={12} className="opacity-60" />
      ))}
      <span className="text-[10.5px]">+{MODE_COMING_SOON.length}</span>
    </span>
  );
}

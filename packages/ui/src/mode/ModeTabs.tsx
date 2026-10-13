/**
 * Work | Math | Term segmented control — sits above the session list, not in the title bar.
 * @module
 */

import type { ReactNode } from 'react';

import { t } from '../i18n/strings.js';
import type { LanguagePref } from '../state/local-prefs.js';
import { MODE_REGISTRY } from './ModeRegistry.js';
import { type AppModeId } from './types.js';

export function ModeTabs({
  mode,
  language,
  onSelect,
}: {
  mode: AppModeId;
  language: LanguagePref;
  onSelect: (id: AppModeId) => void;
  /** @deprecated kept so older call sites type-check during migration */
  taskRunning?: boolean;
}): ReactNode {
  const tr = (k: Parameters<typeof t>[1]) => t(language, k);

  return (
    <div
      className="inline-flex shrink-0 items-center rounded-lg border border-line bg-elevated/60 p-[2px]"
      role="tablist"
      aria-label={tr('mode.work')}
      data-mode-tabs
      data-mode-segment="work-math-term"
    >
      {MODE_REGISTRY.map((def) => {
        const active = def.id === mode;
        return (
          <button
            key={def.id}
            type="button"
            role="tab"
            data-mode-tab={def.id}
            aria-selected={active}
            title={tr(def.descriptionKey as Parameters<typeof t>[1])}
            onClick={() => onSelect(def.id)}
            className={`rounded-md px-2.5 py-[3px] text-[11.5px] font-medium transition-colors ${
              active ? 'bg-accent/15 text-accent shadow-sm' : 'text-ink-2 hover:text-ink'
            }`}
          >
            {tr(def.labelKey as Parameters<typeof t>[1])}
          </button>
        );
      })}
    </div>
  );
}

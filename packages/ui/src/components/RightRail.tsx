/**
 * Right rail — hosts ModeHeader panel bodies (F3).
 *
 * Opened by panel icons; closed when panelId is cleared. Default collapsed (no panel).
 * @module
 */

import { useEffect, type ReactNode } from 'react';

import { panelAvailableIn, panelsForMode } from '../panels.js';
import { t } from '../i18n/strings.js';
import { useUiStore } from '../state/UiProvider.js';
import { PanelBody } from './RunPanels.js';
import { Icon } from './primitives.js';

export function RightRail(): ReactNode {
  const language = useUiStore((s) => s.localPrefs.language);
  const panelId = useUiStore((s) => s.panelId);
  const setPanelId = useUiStore((s) => s.setPanelId);
  const mode = useUiStore((s) => s.mode);
  const tr = (k: Parameters<typeof t>[1]) => t(language, k);

  useEffect(() => {
    if (panelId && !panelAvailableIn(panelId, mode)) setPanelId(undefined);
  }, [panelId, mode, setPanelId]);

  if (!panelId) return null;

  const spec = panelsForMode(mode).find((p) => p.id === panelId);
  const label = spec ? tr(spec.labelKey) : tr('panels.label');

  return (
    <aside
      data-right-rail
      data-panel-deck={panelId}
      aria-label={label}
      className="flex min-h-0 min-w-0 flex-col border-l border-line bg-base/50"
    >
      <div className="flex h-[33px] shrink-0 items-center gap-2 border-b border-line px-3">
        <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium text-ink">{label}</span>
        <button
          type="button"
          data-panel-close
          aria-label={tr('panels.close')}
          className="grid h-5 w-5 place-items-center rounded text-ink-3 hover:bg-hover hover:text-ink"
          onClick={() => setPanelId(undefined)}
        >
          <Icon name="x" size={12} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <PanelBody id={panelId} />
      </div>
    </aside>
  );
}

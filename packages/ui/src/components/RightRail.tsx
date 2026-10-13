/**
 * Right rail — the one drawer for run sections (artifacts, memory, context, …).
 *
 * Opened by the header's single panel toggle. The sections are tabs in this
 * drawer, not icons in the header. Closed when `panelId` is cleared.
 * @module
 */

import { useEffect, type ReactNode } from 'react';

import { panelAvailableIn, panelNeedsTask, panelsForMode } from '../panels.js';
import { t } from '../i18n/strings.js';
import { useUiStore } from '../state/UiProvider.js';
import { PanelBody } from './RunPanels.js';
import { Icon } from './primitives.js';

export function RightRail(): ReactNode {
  const language = useUiStore((s) => s.localPrefs.language);
  const panelId = useUiStore((s) => s.panelId);
  const setPanelId = useUiStore((s) => s.setPanelId);
  const mode = useUiStore((s) => s.mode);
  const hasTask = useUiStore((s) => s.snapshot.task !== undefined);
  const tr = (k: Parameters<typeof t>[1]) => t(language, k);

  useEffect(() => {
    if (panelId && !panelAvailableIn(panelId, mode)) setPanelId(undefined);
  }, [panelId, mode, setPanelId]);

  if (!panelId) return null;

  const panels = panelsForMode(mode);
  const spec = panels.find((p) => p.id === panelId);
  const label = spec ? tr(spec.labelKey) : tr('panels.label');

  return (
    <aside
      data-right-rail
      data-panel-deck={panelId}
      aria-label={label}
      className="flex min-h-0 min-w-0 flex-col border-l border-line bg-base/50"
    >
      <div className="flex h-[33px] shrink-0 items-center gap-2 border-b border-line px-3">
        <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium text-ink">{tr('panels.drawer')}</span>
        <button
          type="button"
          data-panel-close
          aria-label={tr('panels.close')}
          className="grid h-5 w-5 place-items-center rounded text-ink-3 hover:bg-hover hover:text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent"
          onClick={() => setPanelId(undefined)}
        >
          <Icon name="x" size={12} />
        </button>
      </div>
      <div
        role="tablist"
        aria-label={tr('panels.label')}
        data-panel-tabs
        className="flex shrink-0 gap-0.5 overflow-x-auto border-b border-line px-2 py-1.5"
      >
        {panels.map((panel) => {
          const selected = panelId === panel.id;
          const dim = panelNeedsTask(panel.id) && !hasTask;
          return (
            <button
              key={panel.id}
              type="button"
              role="tab"
              data-panel-tab={panel.id}
              aria-selected={selected}
              title={dim ? `${tr(panel.labelKey)} — ${tr('panels.needsTask')}` : tr(panel.labelKey)}
              aria-label={`${tr('panels.open')}：${tr(panel.labelKey)}`}
              className={`inline-flex shrink-0 items-center gap-1 rounded-md border-b px-1.5 py-1 text-[11px] focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                selected
                  ? 'border-accent bg-hover font-medium text-ink'
                  : dim
                    ? 'border-transparent text-ink-3 opacity-40 hover:bg-hover hover:opacity-100'
                    : 'border-transparent text-ink-2 hover:bg-hover hover:text-ink'
              }`}
              onClick={() => setPanelId(panel.id)}
            >
              <Icon name={panel.icon} size={12} />
              <span>{tr(panel.labelKey)}</span>
            </button>
          );
        })}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <PanelBody id={panelId} />
      </div>
    </aside>
  );
}

/**
 * Right rail — an artifacts shelf that stays on the right.
 *
 * Opening the drawer lands on 产物. Run, memory, context, events and
 * sub-agents stay behind a quiet "more" menu so they do not read as a
 * second navigation bar. The collapse control matches the session header:
 * the same size, on the trailing edge, and it is the only drawer toggle
 * while this column is open.
 * @module
 */

import { useState, type ReactNode } from 'react';

import { panelNeedsTask, panelsForMode, type PanelId } from '../panels.js';
import { t } from '../i18n/strings.js';
import { MODE_HEADER_H } from '../modes/ModeHeader.js';
import { useUiStore } from '../state/UiProvider.js';
import { PanelBody } from './RunPanels.js';
import { PanelDrawerToggle } from './PanelIcons.js';

export function RightRail(): ReactNode {
  const language = useUiStore((s) => s.localPrefs.language);
  const panelId = useUiStore((s) => s.panelId);
  const setPanelId = useUiStore((s) => s.setPanelId);
  const mode = useUiStore((s) => s.mode);
  const hasTask = useUiStore((s) => s.snapshot.task !== undefined);
  const tr = (k: Parameters<typeof t>[1]) => t(language, k);
  const [moreOpen, setMoreOpen] = useState(false);

  if (!panelId) return null;

  const panels = panelsForMode(mode);
  const spec = panels.find((p) => p.id === panelId);
  const label = spec ? tr(spec.labelKey) : tr('panel.artifacts');
  const secondary = panels.filter((panel) => panel.id !== 'artifacts');

  const openSection = (id: PanelId): void => {
    setPanelId(id);
    setMoreOpen(false);
  };

  return (
    <aside
      data-right-rail
      data-panel-deck={panelId}
      aria-label={label}
      className="relative flex min-h-0 min-w-0 flex-col border-l border-line bg-base"
    >
      <div
        data-panel-header
        className="flex shrink-0 items-center gap-1 border-b border-line/70 px-3"
        style={{ height: MODE_HEADER_H }}
      >
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink-2">{label}</span>
        {panelId !== 'artifacts' ? (
          <button
            type="button"
            data-panel-home
            className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-ink-3 hover:bg-hover hover:text-ink"
            onClick={() => openSection('artifacts')}
          >
            {tr('panel.artifacts')}
          </button>
        ) : null}
        <div className="relative">
          <button
            type="button"
            data-panel-more
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            aria-label={tr('panels.more')}
            title={tr('panels.more')}
            className={`rounded px-1.5 py-0.5 text-[11px] ${moreOpen ? 'text-ink' : 'text-ink-3 hover:bg-hover hover:text-ink'}`}
            onClick={() => setMoreOpen((open) => !open)}
          >
            {tr('panels.more')}
          </button>
          {moreOpen ? (
            <div
              role="menu"
              data-panel-menu
              aria-label={tr('panels.more')}
              className="absolute right-0 top-full z-20 mt-1 w-36 rounded-md border border-line bg-elevated py-1 shadow-lg"
            >
              {secondary.map((panel) => {
                const selected = panelId === panel.id;
                const dim = panelNeedsTask(panel.id) && !hasTask;
                return (
                  <button
                    key={panel.id}
                    type="button"
                    role="menuitem"
                    data-panel-tab={panel.id}
                    aria-selected={selected}
                    title={dim ? `${tr(panel.labelKey)} — ${tr('panels.needsTask')}` : tr(panel.labelKey)}
                    className={`block w-full truncate px-2.5 py-1.5 text-left text-[12px] hover:bg-hover ${
                      selected ? 'font-medium text-ink' : dim ? 'text-ink-3 opacity-40' : 'text-ink-2'
                    }`}
                    onClick={() => openSection(panel.id)}
                  >
                    {tr(panel.labelKey)}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
        <PanelDrawerToggle embedded />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <PanelBody id={panelId} />
      </div>
    </aside>
  );
}

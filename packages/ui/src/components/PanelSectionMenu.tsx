/**
 * Section switcher for the open right drawer.
 *
 * Sits in the top bar, immediately before the drawer toggle, so 更多 and
 * the panel glyph stay on the window's top-right while the drawer is open.
 * The drawer header keeps the section title and does not host this menu.
 * @module
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';

import { panelNeedsTask, panelsForMode, type PanelId } from '../panels.js';
import { t } from '../i18n/strings.js';
import { useUiStore } from '../state/UiProvider.js';

export function PanelSectionMenu(): ReactNode {
  const language = useUiStore((s) => s.localPrefs.language);
  const panelId = useUiStore((s) => s.panelId);
  const setPanelId = useUiStore((s) => s.setPanelId);
  const mode = useUiStore((s) => s.mode);
  const hasTask = useUiStore((s) => s.snapshot.task !== undefined);
  const tr = (k: Parameters<typeof t>[1]) => t(language, k);
  const [moreOpen, setMoreOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!moreOpen) return;
    const onPointer = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setMoreOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMoreOpen(false);
    };
    window.addEventListener('mousedown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [moreOpen]);

  if (!panelId) return null;

  const secondary = panelsForMode(mode).filter((panel) => panel.id !== 'artifacts');

  const openSection = (id: PanelId): void => {
    setPanelId(id);
    setMoreOpen(false);
  };

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        data-panel-more
        aria-haspopup="menu"
        aria-expanded={moreOpen}
        aria-label={tr('panels.more')}
        title={tr('panels.more')}
        className={`rounded px-1.5 py-0.5 text-[12px] focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent ${
          moreOpen ? 'text-ink' : 'text-ink-3 hover:bg-hover hover:text-ink'
        }`}
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
                className={`block w-full truncate px-2.5 py-1.5 text-left text-[12px] hover:bg-hover focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-[-2px] focus-visible:outline-accent ${
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
  );
}

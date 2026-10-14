/**
 * Right rail — an artifacts shelf that stays on the right.
 *
 * Opening the drawer lands on 产物. Run, memory, context, events and
 * sub-agents stay behind the top bar's 更多 menu, so this column does not
 * grow a second navigation bar. The drawer toggle stays in that top bar
 * too — this header is the section title, not a second close control.
 * @module
 */

import type { ReactNode } from 'react';

import { panelsForMode } from '../panels.js';
import { t } from '../i18n/strings.js';
import { MODE_HEADER_H } from '../modes/ModeHeader.js';
import { useUiStore } from '../state/UiProvider.js';
import { PanelBody } from './RunPanels.js';

export function RightRail(): ReactNode {
  const language = useUiStore((s) => s.localPrefs.language);
  const panelId = useUiStore((s) => s.panelId);
  const setPanelId = useUiStore((s) => s.setPanelId);
  const mode = useUiStore((s) => s.mode);
  const tr = (k: Parameters<typeof t>[1]) => t(language, k);

  if (!panelId) return null;

  const panels = panelsForMode(mode);
  const spec = panels.find((p) => p.id === panelId);
  const label = spec ? tr(spec.labelKey) : tr('panel.artifacts');

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
            className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-ink-3 hover:bg-hover hover:text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent"
            onClick={() => setPanelId('artifacts')}
          >
            {tr('panel.artifacts')}
          </button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <PanelBody id={panelId} />
      </div>
    </aside>
  );
}

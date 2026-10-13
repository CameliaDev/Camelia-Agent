/**
 * Panel icons — the six run panels, as a row in `ModeHeader`'s trailing slot.
 *
 * ## Why the header
 *
 * These were tabs in the right rail, a fourth column. That column is gone. The header is
 * where they went because it is the one row that never scrolls away and that all three
 * modes already share — the same doctrine as `ModeHeader` itself and `RunControls`: a
 * capability that exists in one mode and not another is missing exactly where it is
 * needed. Measured budget: the strip is 1084px, the lifecycle stepper takes 335px, and six
 * 24px icons with gaps come to 164px. There is room, and the stepper never has to give way.
 *
 * ## Dimmed, never hidden
 *
 * Three of the six need a task before they show anything. On an idle window those icons are
 * drawn at reduced opacity with a tooltip that says *why* — the panel opens and explains
 * itself rather than refusing. A control that vanishes reads as a control that broke, which
 * is the report this row exists to end.
 *
 * They are never hidden instead, and never reordered by availability: a row that reflows as
 * a task starts is a row the user has to re-find.
 *
 * ## The active one
 *
 * Clicking the open panel closes it, the way every view toggle in an editor behaves. The
 * accent mark is the only thing saying which panel is open, because the deck can be scrolled
 * out of view while the header cannot.
 * @module
 */

import type { ReactNode } from 'react';

import { panelNeedsTask, panelsForMode, type PanelId } from '../panels.js';
import { t } from '../i18n/strings.js';
import { useUiStore } from '../state/UiProvider.js';
import { Icon } from './primitives.js';

const ICON_BUTTON =
  'group relative grid h-6 w-6 shrink-0 place-items-center rounded text-ink-3 transition-colors hover:bg-hover hover:text-ink';

export function PanelIcons(): ReactNode {
  const language = useUiStore((s) => s.localPrefs.language);
  const mode = useUiStore((s) => s.mode);
  const hasTask = useUiStore((s) => s.snapshot.task !== undefined);
  const panelId = useUiStore((s) => s.panelId);
  const setPanelId = useUiStore((s) => s.setPanelId);
  const tr = (k: Parameters<typeof t>[1]) => t(language, k);

  return (
    <span className="flex shrink-0 items-center gap-0.5" data-panel-icons role="group" aria-label={tr('panels.label')}>
      {panelsForMode(mode).map((panel) => {
        const open = panelId === panel.id;
        const dim = panelNeedsTask(panel.id) && !hasTask;
        return (
          <button
            key={panel.id}
            type="button"
            data-panel-icon={panel.id}
            aria-pressed={open}
            // The label is the tooltip even when dimmed, because that is the case where the
            // reader most needs to know what the icon is and why it is quiet.
            title={dim ? `${tr(panel.labelKey)} — ${tr('panels.needsTask')}` : tr(panel.labelKey)}
            // Prefixed, and that is not decoration. The run panel's label is 「运行」 and the
            // composer's submit button is also 「运行」; a bare label made two different
            // controls answer to the same accessible name, which is both a screen-reader
            // ambiguity and a trap for `getByRole('button', { name: '运行' })`.
            aria-label={`${tr('panels.open')}：${tr(panel.labelKey)}`}
            className={`${ICON_BUTTON} ${open ? 'bg-accent/10 text-accent' : dim ? 'opacity-40' : ''}`}
            onClick={() => setPanelId(open ? undefined : (panel.id as PanelId))}
          >
            <Icon name={panel.icon} size={13} />
          </button>
        );
      })}
    </span>
  );
}
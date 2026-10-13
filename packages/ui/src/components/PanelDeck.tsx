/**
 * Panel deck — the open run panel, laid out horizontally in the work area.
 *
 * ## 横着放, not stacked in a column
 *
 * The panels came out of the right rail, where they were stacked in a 360px column. The user
 * asked for them 横着放 and it is also the better fit here: the event trail and the step list
 * are lists of timestamped rows that were being truncated at 360px, and the context panel
 * draws a full-width meter that a narrow column could only ever show as a sliver. The width
 * that used to be taken by a permanently-visible column is now spent on the panel only
 * while one is open.
 *
 * ## It is a horizontal band, not a sidebar
 *
 * It sits between the mode workspace and the composer, `shrink-0`, capped at 38vh: a fixed
 * height would either waste space on a short panel or clip the compaction inspector, which
 * expands to show every dropped original. The cap means the transcript above keeps its
 * scroll position instead of being pushed off-screen by an expanding panel.
 *
 * ## Closeable from two places
 *
 * The icon in the header closes it, and so does the `×` here. A panel that can only be
 * dismissed by a control it covers is a panel the user can get stuck behind — and the
 * header row is short enough on a small window that the icon may not be where they look.
 *
 * ## It draws no title of its own
 *
 * Every panel body already opens with a `SectionHeader` carrying its name plus the controls
 * that belong to it (the progress bar, the step count, the collapse chevron). A title row
 * above those printed the same word twice, and 「事件」 twice in one band reads as two
 * different things that happen to share a name. So the deck supplies only the `×`, floated
 * over its own top-right corner where it cannot collide with a section's own `right` slot.
 * Which panel is open is stated by the accent-marked icon in the header, which — unlike
 * this band — cannot be scrolled out of view.
 *
 * ## Which panel is open is not local state
 *
 * `store.panelId`, because the icon that opens it lives in the shared header and this deck
 * lives in `App`. Same reasoning as `steeringOpen`.
 * @module
 */

import { useEffect, type ReactNode } from 'react';

import { panelAvailableIn, panelsForMode } from '../panels.js';
import { t } from '../i18n/strings.js';
import { useUiStore } from '../state/UiProvider.js';
import { PanelBody } from './RunPanels.js';
import { Icon } from './primitives.js';

/** Never more than this share of the window; the workspace keeps the rest. */
const MAX_H = '38vh';

export function PanelDeck(): ReactNode {
  const language = useUiStore((s) => s.localPrefs.language);
  const panelId = useUiStore((s) => s.panelId);
  const setPanelId = useUiStore((s) => s.setPanelId);
  const mode = useUiStore((s) => s.mode);
  const tr = (k: Parameters<typeof t>[1]) => t(language, k);

  // Switching math → chat while the model panel is open would otherwise leave a body on
  // screen whose icon the header no longer draws: something open with no way to close it.
  useEffect(() => {
    if (panelId && !panelAvailableIn(panelId, mode)) setPanelId(undefined);
  }, [panelId, mode, setPanelId]);

  if (!panelId) return null;

  const spec = panelsForMode(mode).find((p) => p.id === panelId);
  const label = spec ? tr(spec.labelKey) : tr('panels.label');

  return (
    <section
      className="camelia-panel-deck relative shrink-0 overflow-y-auto border-t border-line bg-base/40"
      style={{ maxHeight: MAX_H }}
      data-panel-deck={panelId}
      aria-label={label}
    >
      {/*
        Absolute, not a flex row: the band has no header of its own, and a `×` in normal
        flow would need a row to live in — which is the row that would then print the
        panel's name a second time.
      */}
      <button
        type="button"
        data-panel-close
        aria-label={tr('panels.close')}
        title={tr('panels.close')}
        className="absolute right-1.5 top-1.5 z-10 grid h-5 w-5 place-items-center rounded bg-base/80 text-ink-3 hover:bg-hover hover:text-ink"
        onClick={() => setPanelId(undefined)}
      >
        <Icon name="x" size={12} />
      </button>

      {/*
        The widest panel is the event trail, and a single column at full width would leave a
        1440px row with one short line of text in it. `minmax` lets narrow panels sit side by
        side while wide ones still get the full row — the layout follows the content instead
        of a fixed column count that would be wrong for half the panels.
      */}
      <div className="grid grid-cols-1 items-start gap-x-4 md:grid-cols-2 xl:grid-cols-3">
        <PanelBody id={panelId} />
      </div>
    </section>
  );
}
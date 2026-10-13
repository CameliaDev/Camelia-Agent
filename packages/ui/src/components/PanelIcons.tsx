/**
 * One drawer toggle for the right rail.
 *
 * The six run sections used to sit in this header as a row of icons. They now live
 * inside the drawer (`RightRail`) as tabs. The header keeps a single `panel-right`
 * glyph — open the rail, or close it — the way a chat app opens its side panel.
 * @module
 */

import type { ReactNode } from 'react';

import { t } from '../i18n/strings.js';
import { useUiStore } from '../state/UiProvider.js';
import { Icon } from './primitives.js';

const TOGGLE =
  'grid h-6 w-6 shrink-0 place-items-center rounded text-ink-3 transition-colors hover:bg-hover hover:text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent';

export function PanelDrawerToggle(): ReactNode {
  const language = useUiStore((s) => s.localPrefs.language);
  const panelId = useUiStore((s) => s.panelId);
  const toggle = useUiStore((s) => s.togglePanelDrawer);
  const tr = (k: Parameters<typeof t>[1]) => t(language, k);
  const open = panelId !== undefined;

  return (
    <button
      type="button"
      data-panel-drawer
      aria-pressed={open}
      aria-expanded={open}
      title={open ? tr('panels.toggleClose') : tr('panels.toggleOpen')}
      aria-label={open ? tr('panels.toggleClose') : tr('panels.toggleOpen')}
      className={`${TOGGLE} ${open ? 'bg-accent/10 text-accent' : ''}`}
      onClick={() => toggle()}
    >
      <Icon name="panelRight" size={14} />
    </button>
  );
}

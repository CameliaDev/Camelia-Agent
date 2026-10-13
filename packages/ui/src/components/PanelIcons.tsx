/**
 * The paired sidebar toggles.
 *
 * Left and right use the same button: one glyph, one click, open or closed.
 * While a side is open the control sits in that side's header. While it is
 * closed the same control moves to the top bar, so expand stays reachable
 * after the panel itself is gone. Only one instance of each is mounted.
 * @module
 */

import type { ReactNode } from 'react';

import { t } from '../i18n/strings.js';
import { useUiStore } from '../state/UiProvider.js';
import { Icon } from './primitives.js';

const TOGGLE =
  'grid h-6 w-6 shrink-0 place-items-center rounded text-ink-3 transition-colors hover:bg-hover hover:text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent';

/** Collapse or expand the session column. Mirrors `PanelDrawerToggle`. */
export function LeftSidebarToggle(): ReactNode {
  const language = useUiStore((s) => s.localPrefs.language);
  const leftOpen = !useUiStore((s) => s.localPrefs.leftCollapsed);
  const setLocalPrefs = useUiStore((s) => s.setLocalPrefs);
  const tr = (k: Parameters<typeof t>[1]) => t(language, k);

  return (
    <button
      type="button"
      data-layout-sidebar
      data-session-collapse
      aria-pressed={leftOpen}
      title={leftOpen ? tr('sessions.collapse') : tr('sessions.expand')}
      aria-label={leftOpen ? tr('sessions.collapse') : tr('sessions.expand')}
      className={`${TOGGLE} ${leftOpen ? 'text-ink' : ''}`}
      onClick={() => setLocalPrefs({ leftCollapsed: leftOpen })}
    >
      <Icon name="panelLeft" size={14} />
    </button>
  );
}

/** Open or close the right drawer. `embedded` marks the copy that lives in the drawer. */
export function PanelDrawerToggle({ embedded = false }: { embedded?: boolean }): ReactNode {
  const language = useUiStore((s) => s.localPrefs.language);
  const panelId = useUiStore((s) => s.panelId);
  const toggle = useUiStore((s) => s.togglePanelDrawer);
  const tr = (k: Parameters<typeof t>[1]) => t(language, k);
  const open = panelId !== undefined;

  return (
    <button
      type="button"
      data-panel-drawer
      data-panel-close={embedded ? '' : undefined}
      aria-pressed={open}
      aria-expanded={open}
      title={open ? tr('panels.toggleClose') : tr('panels.toggleOpen')}
      aria-label={open ? tr('panels.toggleClose') : tr('panels.toggleOpen')}
      className={`${TOGGLE} ${open ? 'text-ink' : ''}`}
      onClick={() => toggle()}
    >
      <Icon name="panelRight" size={14} />
    </button>
  );
}

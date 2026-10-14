/**
 * Sidebar toggles that live in the top bar.
 *
 * The right drawer has one toggle, and it stays in the top bar whether the
 * drawer is open or shut. The left column does not: collapsing it is the
 * activity bar (click the open chats or plugins icon). This left button is
 * only the way back, mounted in the top bar while that column is closed.
 * @module
 */

import type { ReactNode } from 'react';

import { t } from '../i18n/strings.js';
import { useUiStore } from '../state/UiProvider.js';
import { Icon } from './primitives.js';

const TOGGLE =
  'grid h-6 w-6 shrink-0 place-items-center rounded text-ink-3 transition-colors hover:bg-hover hover:text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent';

/**
 * Expand the session column.
 *
 * Mounted in the top bar only while the column is closed. The activity bar
 * is what tucks it away; this button is not placed in the session header.
 */
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

/** Open or close the right drawer. One control, always in the top bar. */
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
      data-panel-close={open ? '' : undefined}
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

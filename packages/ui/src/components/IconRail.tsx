/**
 * Left icon rail — the permanent strip outside the left column.
 *
 * The shell reads as four columns: this strip, the session column, the conversation, the
 * detail rail. The strip never collapses, and that is the whole point of it. When the
 * session column is shut its own chrome goes with it — the search box, the new-chat
 * button, the header — and this is what remains: reopen the list, search it, start a new
 * chat, reach settings, from anywhere.
 *
 * ## The foot of the strip: account, then settings
 *
 * Two entries, in that order — the way an editor's activity bar does it. The account mark
 * opens a small Accounts menu (VS Code–style) anchored beside the avatar: who is signed in,
 * GitHub sign-in / sign-out, and an optional jump into Settings → Account. The gear still
 * opens Settings proper. They must not share a destination — one control claiming two jobs
 * is how the old "account & settings" button failed.
 *
 * The rail is also the account's only home. It used to draw a mark at its foot while the
 * session column drew a profile row under its list, so an open column showed the same
 * identity twice; that row is gone (name, version line and all).
 *
 * ## Adding to it
 *
 * This strip is the extension point for left-side surfaces, and it is deliberately the
 * *only* place left chrome is added. A new **view** — a panel that wants the left column —
 * is a button in the top group plus the panel in the column it opens; the toggle, the
 * active mark and the tooltip all come from the same three classes, so a second view looks
 * like the first without restating anything. A new **action** belongs in the group it
 * affects.
 *
 * Nothing here may be a control that cannot act. The codebase's rule is that a dead button
 * is worse than a missing one (see `Composer`'s module note), so the strip ships only
 * entries that already have an engine or a shell surface behind them — which is why it has
 * four icons and not the eight a wireframe would draw.
 *
 * ## Why the session column closes to 0 and not to 48px
 *
 * With a strip outside it, a 48px collapsed session column would put two re-open controls
 * side by side for one panel. The column therefore closes to nothing, and this strip owns
 * re-opening it. See `railWidth`.
 *
 * ## Width
 *
 * `RAIL_ICON_WIDTH` fits an icon and a short label. Sessions, plugins, and settings
 * are labeled rows. Search and new chat stay icon actions under them — they act on
 * the session list, they are not destinations.
 * @module
 */

import { useState, type ReactNode } from 'react';

import { t } from '../i18n/strings.js';
import { useNewSession } from '../state/new-session.js';
import { useUiStore } from '../state/UiProvider.js';
import { AccountMenu } from './AccountMenu.js';
import { Avatar, Icon, userAvatarSrc } from './primitives.js';

/**
 * Open the session column, then focus its search field.
 *
 * The input is not in the DOM while the column is closed, so this has to wait for React to
 * commit the width change. A macrotask is enough — React commits synchronously inside the
 * click handler, so by the time the timer runs the field exists — and unlike a paint frame
 * it is deterministic under jsdom, where the tests run.
 */
function focusSessionSearch(): void {
  const find = (attempt = 0): void => {
    const input = document.querySelector<HTMLInputElement>('[data-session-search]');
    if (input) {
      input.focus();
      return;
    }
    if (attempt < 10) window.setTimeout(() => find(attempt + 1), 0);
  };
  find();
}

/** Labeled destination. Icon and word share one quiet row. */
const NAV = 'group relative flex h-8 w-full shrink-0 items-center gap-2 rounded-lg px-2 text-left text-[12px] transition-colors';
/** Icon-only action that belongs to the session list, not a destination of its own. */
const ACTION = 'group relative grid h-8 w-8 shrink-0 place-items-center rounded-lg transition-colors';
const ITEM_IDLE = 'text-ink-2 hover:bg-hover hover:text-ink';
const ITEM_ACTIVE = 'bg-hover text-ink';

/** Tooltip, opening to the right: this strip is against the window edge. */
function Tip({ children }: { children: ReactNode }): ReactNode {
  return (
    <span
      data-tip
      className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 hidden -translate-y-1/2 whitespace-nowrap rounded border border-line bg-panel px-2 py-1 text-[11px] text-ink group-hover:block"
    >
      {children}
    </span>
  );
}

export function IconRail(): ReactNode {
  const lang = useUiStore((s) => s.localPrefs.language);
  const leftCollapsed = useUiStore((s) => s.localPrefs.leftCollapsed);
  const sidebarView = useUiStore((s) => s.sidebarView);
  const setSidebarView = useUiStore((s) => s.setSidebarView);
  const userAvatar = useUiStore((s) => s.localPrefs.userAvatar);
  const githubAccount = useUiStore((s) => s.localPrefs.githubAccount);
  const displayNamePref = useUiStore((s) => s.localPrefs.displayName);
  const setLocalPrefs = useUiStore((s) => s.setLocalPrefs);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const newSession = useNewSession();
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const tr = (k: Parameters<typeof t>[1]) => t(lang, k);
  /**
   * The name the user configured, or nothing.
   *
   * Deliberately *not* falling back to the built-in label: this is the only place the name
   * is drawn, and a hover card announcing "本地用户" to someone who never chose a name is
   * noise pretending to be information. The Settings field behind it (whose placeholder is
   * the built-in label) would otherwise be a control with no effect anywhere — the text row
   * it used to feed at the foot of the session column is gone.
   */
  const displayName = (githubAccount?.name || githubAccount?.login || displayNamePref).trim();

  return (
    <aside
      data-rail="icon"
      aria-label={tr('rail.label')}
      /*
        No `overflow-hidden`. Tooltips on the icon actions open to the right, and a clip
        on this nav would hide them. The labeled rows do not overflow the column.
      */
      className="relative flex h-full w-full flex-col gap-0.5 border-r border-line bg-base px-2 py-2"
    >
      {/*
        Labeled destinations. Clicking the open view closes the column, the same
        contract as an activity bar, so this nav can drive the sidebar alone.
      */}
      <button
        type="button"
        data-rail-view="sessions"
        aria-pressed={!leftCollapsed && sidebarView === 'sessions'}
        title={tr('sessions.history')}
        aria-label={tr('rail.sessions')}
        className={`${NAV} ${!leftCollapsed && sidebarView === 'sessions' ? ITEM_ACTIVE : ITEM_IDLE}`}
        onClick={() => {
          if (!leftCollapsed && sidebarView === 'sessions') {
            setLocalPrefs({ leftCollapsed: true });
            return;
          }
          setSidebarView('sessions');
          setLocalPrefs({ leftCollapsed: false });
        }}
      >
        <Icon name="chat" size={16} />
        <span className="min-w-0 truncate">{tr('sessions.history')}</span>
      </button>

      <button
        type="button"
        data-rail-view="extensions"
        aria-pressed={!leftCollapsed && sidebarView === 'extensions'}
        title={tr('extensions.title')}
        aria-label={tr('rail.extensions')}
        className={`${NAV} ${!leftCollapsed && sidebarView === 'extensions' ? ITEM_ACTIVE : ITEM_IDLE}`}
        onClick={() => {
          if (!leftCollapsed && sidebarView === 'extensions') {
            setLocalPrefs({ leftCollapsed: true });
            return;
          }
          setSidebarView('extensions');
          setLocalPrefs({ leftCollapsed: false });
        }}
      >
        <Icon name="extensions" size={16} />
        <span className="min-w-0 truncate">{tr('extensions.title')}</span>
      </button>

      <div className="mt-1 flex items-center gap-0.5 px-0.5">
        <button
          type="button"
          data-rail-action="search"
          title={tr('rail.search')}
          aria-label={tr('rail.search')}
          className={`${ACTION} ${ITEM_IDLE}`}
          onClick={() => {
            setSidebarView('sessions');
            setLocalPrefs({ leftCollapsed: false });
            focusSessionSearch();
          }}
        >
          <Icon name="search" size={15} />
          <Tip>{tr('rail.search')}</Tip>
        </button>
        <button
          type="button"
          data-rail-action="new"
          title={tr('rail.new')}
          aria-label={tr('rail.new')}
          className={`${ACTION} ${ITEM_IDLE}`}
          onClick={() => newSession()}
        >
          <Icon name="plus" size={15} />
          <Tip>{tr('rail.new')}</Tip>
        </button>
      </div>

      <span className="flex-1" />

      {/*
        The account mark opens the Accounts menu — not Settings. Settings is the gear below.
        `relative` on the aside lets the menu anchor to the foot of the strip.
      */}
      <div className="relative">
        <button
          type="button"
          data-rail-account
          aria-label={tr('account.profile')}
          aria-haspopup="menu"
          aria-expanded={accountMenuOpen}
          className={`${NAV} ${accountMenuOpen ? ITEM_ACTIVE : ITEM_IDLE}`}
          onClick={() => setAccountMenuOpen((open) => !open)}
        >
          <Avatar kind="user" size={18} src={userAvatarSrc(userAvatar, githubAccount)} />
          <span className="min-w-0 flex-1 truncate text-[12px]">{displayName || tr('account.profile')}</span>
          {!accountMenuOpen ? (
            <Tip>
              {displayName ? (
                <>
                  {displayName}
                  <span className="text-ink-3"> · </span>
                </>
              ) : null}
              {tr('account.profile')}
            </Tip>
          ) : null}
        </button>
        {accountMenuOpen ? <AccountMenu onClose={() => setAccountMenuOpen(false)} /> : null}
      </div>

      {/*
        The gear, set a step further down than the account mark so the two read as separate
        entries rather than a pair — `gap-1` alone leaves them looking like one stack.
      */}
      <button
        type="button"
        data-rail-settings
        aria-label={tr('settings.title')}
        className={`${NAV} ${ITEM_IDLE} mt-0.5`}
        onClick={() => {
          setAccountMenuOpen(false);
          setSettingsOpen(true);
        }}
      >
        <Icon name="settings" size={16} />
        <span className="min-w-0 truncate">{tr('settings.title')}</span>
      </button>
    </aside>
  );
}

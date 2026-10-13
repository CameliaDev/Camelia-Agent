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
 * Two entries, in that order — the way an editor's activity bar does it. They were once a
 * single button labelled "account & settings", which is one control claiming two jobs: a
 * reader clicking it could not tell whether they were about to configure themselves or the
 * application. Now the mark opens the page where *you* are configured (appearance: avatar,
 * name, theme, language) and the gear opens settings proper. Each says what it opens.
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
 * `RAIL_ICON_WIDTH` is the same 48px as a collapsed rail, so the icons sit on the same
 * grid line whether the column beside them is open or shut.
 * @module
 */

import type { ReactNode } from 'react';

import { t } from '../i18n/strings.js';
import { useNewSession } from '../state/new-session.js';
import { useUiStore } from '../state/UiProvider.js';
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

/** Shared by every button in the strip, so a new entry cannot look unlike its neighbours. */
const ITEM = 'group relative grid h-8 w-8 shrink-0 place-items-center rounded-md transition-colors';
const ITEM_IDLE = 'text-ink-2 hover:bg-hover hover:text-ink';
const ITEM_ACTIVE = 'bg-accent/10 text-accent';

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
  const userAvatar = useUiStore((s) => s.localPrefs.userAvatar);
  const githubAccount = useUiStore((s) => s.localPrefs.githubAccount);
  const displayNamePref = useUiStore((s) => s.localPrefs.displayName);
  const setLocalPrefs = useUiStore((s) => s.setLocalPrefs);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const newSession = useNewSession();
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
        No `overflow-hidden`. It used to be here, and it silently ate every tooltip in the
        strip: `Tip` opens to the right, and clipping at the 48px boundary meant hovering an
        icon produced only the hover background, never the label. Nothing overflows this
        strip in practice — the buttons are 32px in a 48px column, and the vertical slack is
        the flex spacer — so the clip bought nothing and cost the only visible affordance
        these icons have.
      */
      className="flex h-full w-full flex-col items-center gap-1 border-r border-line bg-base py-2"
    >
      {/*
        The view toggle. Clicking the open view closes it, which is what every activity
        bar does — and it means the strip alone is enough to drive the column, so the
        column's own collapse button is a convenience rather than the only way out.
      */}
      <button
        type="button"
        data-rail-view="sessions"
        aria-pressed={!leftCollapsed}
        title={tr('rail.sessions')}
        aria-label={tr('rail.sessions')}
        className={`${ITEM} ${leftCollapsed ? ITEM_IDLE : ITEM_ACTIVE}`}
        onClick={() => setLocalPrefs({ leftCollapsed: !leftCollapsed })}
      >
        <Icon name="chat" size={16} />
        <Tip>{tr('rail.sessions')}</Tip>
      </button>

      {/* An action on that column, so it lives beside the view it acts on. */}
      <button
        type="button"
        data-rail-action="search"
        title={tr('rail.search')}
        aria-label={tr('rail.search')}
        className={`${ITEM} ${ITEM_IDLE}`}
        onClick={() => {
          setLocalPrefs({ leftCollapsed: false });
          focusSessionSearch();
        }}
      >
        <Icon name="search" size={16} />
        <Tip>{tr('rail.search')}</Tip>
      </button>

      <button
        type="button"
        data-rail-action="new"
        title={tr('rail.new')}
        aria-label={tr('rail.new')}
        className={`${ITEM} ${ITEM_IDLE}`}
        onClick={newSession}
      >
        <Icon name="plus" size={16} />
        <Tip>{tr('rail.new')}</Tip>
      </button>

      <span className="flex-1" />

      {/*
        The account mark: no name row, no version line — text cannot live in 48px, and the
        name is one hover away. It opens *appearance*, which is the page that owns the
        avatar and the display name; sending it to the drawer's first page would make it a
        second copy of the gear.

        No `title`: the strip draws its own tooltip and a native one would appear beside it.
      */}
      <button
        type="button"
        data-rail-account
        aria-label={tr('account.profile')}
        className={`${ITEM} ${ITEM_IDLE}`}
        onClick={() => setSettingsOpen(true, 'account')}
      >
        <Avatar kind="user" size={22} src={userAvatarSrc(userAvatar, githubAccount)} />
        <Tip>
          {displayName ? (
            <>
              {displayName}
              <span className="text-ink-3"> · </span>
            </>
          ) : null}
          {tr('account.profile')}
        </Tip>
      </button>

      {/*
        The gear, set a step further down than the account mark so the two read as separate
        entries rather than a pair — `gap-1` alone leaves them looking like one stack.
      */}
      <button
        type="button"
        data-rail-settings
        aria-label={tr('settings.title')}
        className={`${ITEM} ${ITEM_IDLE} mt-1`}
        onClick={() => setSettingsOpen(true)}
      >
        <Icon name="settings" size={16} />
        <Tip>{tr('settings.title')}</Tip>
      </button>
    </aside>
  );
}

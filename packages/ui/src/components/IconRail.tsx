/**
 * Left icon rail — the permanent strip outside the left column.
 *
 * The shell reads as four columns: this strip, the session column, the conversation, the
 * detail rail. The strip never collapses, and that is the whole point of it. When the
 * session column is shut its own chrome goes with it — the search box, the new-chat
 * button, the header — and this is what remains: reopen the list and reach settings,
 * from anywhere. Search and new chat live in the session column toolbar, not here.
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
 * `RAIL_ICON_WIDTH` is 48px. This is an activity bar, not a labeled nav: every
 * entry is an icon, and the word lives in the tooltip and the accessible name.
 * The session list is the column to the right of this strip. Search and new
 * chat live in that column's header toolbar, not on this strip.
 * @module
 */

import { useState, type ReactNode } from 'react';

import { t } from '../i18n/strings.js';
import { useMode } from '../mode/useMode.js';
import { shellModeInstalled } from '../state/shell-plugins.js';
import { useUiStore } from '../state/UiProvider.js';
import { AccountMenu } from './AccountMenu.js';
import { GearMenu } from './GearMenu.js';
import { Avatar, Icon, userAvatarSrc } from './primitives.js';

/** One activity-bar cell. The glyph is the control; the word is the tooltip. */
const CELL =
  'group relative grid h-9 w-9 shrink-0 place-items-center rounded-md transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ink/40';
const ITEM_IDLE = 'text-ink-3 hover:bg-hover hover:text-ink';
const ITEM_ACTIVE = 'text-ink';

/** Left edge mark for the open activity-bar view. The glyph stays unboxed. */
function ActiveMark(): ReactNode {
  return (
    <span
      aria-hidden="true"
      data-rail-active
      className="pointer-events-none absolute -left-1.5 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-accent"
    />
  );
}

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
  const installedPlugins = useUiStore((s) => s.installedPlugins);
  const { mode, setMode } = useMode();
  const mathInstalled = shellModeInstalled(installedPlugins, 'math');
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [gearOpen, setGearOpen] = useState(false);
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
        No `overflow-hidden`. Tooltips open to the right, and a clip on this
        nav would hide them. Icons stay inside the 48px track.
      */
      className="relative flex h-full w-full flex-col items-center gap-0.5 border-r border-line/70 bg-base py-1.5"
    >
      {/*
        Icon destinations. Clicking the open view closes the column, the same
        contract as an activity bar, so this nav can drive the sidebar alone.
        The word is a tooltip — the strip is too narrow to carry a label.
      */}
      <button
        type="button"
        data-rail-view="sessions"
        aria-pressed={!leftCollapsed && sidebarView === 'sessions'}
        title={tr('sessions.history')}
        aria-label={tr('rail.sessions')}
        className={`${CELL} ${!leftCollapsed && sidebarView === 'sessions' ? ITEM_ACTIVE : ITEM_IDLE}`}
        onClick={() => {
          if (!leftCollapsed && sidebarView === 'sessions') {
            setLocalPrefs({ leftCollapsed: true });
            return;
          }
          setSidebarView('sessions');
          setLocalPrefs({ leftCollapsed: false });
        }}
      >
        {!leftCollapsed && sidebarView === 'sessions' ? <ActiveMark /> : null}
        <Icon name="chat" size={22} />
        <Tip>{tr('sessions.history')}</Tip>
      </button>

      <button
        type="button"
        data-rail-view="extensions"
        aria-pressed={!leftCollapsed && sidebarView === 'extensions'}
        title={tr('extensions.title')}
        aria-label={tr('rail.extensions')}
        className={`${CELL} ${!leftCollapsed && sidebarView === 'extensions' ? ITEM_ACTIVE : ITEM_IDLE}`}
        onClick={() => {
          if (!leftCollapsed && sidebarView === 'extensions') {
            setLocalPrefs({ leftCollapsed: true });
            return;
          }
          setSidebarView('extensions');
          setLocalPrefs({ leftCollapsed: false });
        }}
      >
        {!leftCollapsed && sidebarView === 'extensions' ? <ActiveMark /> : null}
        <Icon name="extensions" size={22} />
        <Tip>{tr('extensions.title')}</Tip>
      </button>

      <button
        type="button"
        data-rail-view="skills"
        aria-pressed={!leftCollapsed && sidebarView === 'skills'}
        title={tr('skills.title')}
        aria-label={tr('rail.skills')}
        className={`${CELL} ${!leftCollapsed && sidebarView === 'skills' ? ITEM_ACTIVE : ITEM_IDLE}`}
        onClick={() => {
          if (!leftCollapsed && sidebarView === 'skills') {
            setLocalPrefs({ leftCollapsed: true });
            return;
          }
          setSidebarView('skills');
          setLocalPrefs({ leftCollapsed: false });
        }}
      >
        {!leftCollapsed && sidebarView === 'skills' ? <ActiveMark /> : null}
        <Icon name="skills" size={22} />
        <Tip>{tr('skills.title')}</Tip>
      </button>

      {mathInstalled ? (
        <button
          type="button"
          data-rail-view="math"
          aria-pressed={mode === 'math' && !leftCollapsed && sidebarView === 'sessions'}
          title={tr('mode.math')}
          aria-label={tr('mode.math')}
          className={`${CELL} ${mode === 'math' && !leftCollapsed && sidebarView === 'sessions' ? ITEM_ACTIVE : ITEM_IDLE}`}
          onClick={() => {
            if (mode === 'math' && !leftCollapsed && sidebarView === 'sessions') {
              setLocalPrefs({ leftCollapsed: true });
              return;
            }
            setMode('math');
            setSidebarView('sessions');
            setLocalPrefs({ leftCollapsed: false });
          }}
        >
          {mode === 'math' && !leftCollapsed && sidebarView === 'sessions' ? <ActiveMark /> : null}
          <Icon name="sigma" size={22} />
          <Tip>{tr('mode.math')}</Tip>
        </button>
      ) : null}

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
          className={`${CELL} ${accountMenuOpen ? ITEM_ACTIVE : ITEM_IDLE}`}
          onClick={() => {
            setGearOpen(false);
            setAccountMenuOpen((open) => !open);
          }}
        >
          <Avatar kind="user" size={20} src={userAvatarSrc(userAvatar, githubAccount)} />
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
      <div className="relative">
        <button
          type="button"
          data-rail-settings
          title={tr('settings.title')}
          aria-label={tr('settings.title')}
          aria-haspopup="menu"
          aria-expanded={gearOpen}
          className={`${CELL} ${gearOpen ? ITEM_ACTIVE : ITEM_IDLE} mt-0.5`}
          onClick={() => {
            setAccountMenuOpen(false);
            setGearOpen((open) => !open);
          }}
        >
          <Icon name="settings" size={20} />
          {!gearOpen ? <Tip>{tr('settings.title')}</Tip> : null}
        </button>
        {gearOpen ? <GearMenu onClose={() => setGearOpen(false)} /> : null}
      </div>
    </aside>
  );
}

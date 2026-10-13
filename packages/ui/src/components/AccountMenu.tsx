/**
 * VS Code–style Accounts popover, anchored to the icon-rail account mark.
 *
 * The mark used to open Settings on the account page. That jumps the whole shell into a
 * full drawer for what is usually a two-click job (see who is signed in / sign out). This
 * menu stays next to the avatar: identity, GitHub sign-in / sign-out, and one optional
 * "Account settings…" that still opens the Settings account section when the user wants the
 * longer form (display name, token paste with hints).
 *
 * The gear below the mark is untouched — it still opens Settings on its default page.
 * @module
 */

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

import { t } from '../i18n/strings.js';
import { useUiStore } from '../state/UiProvider.js';
import {
  GITHUB_CLASSIC_TOKEN_URL,
  loginWithGithubToken,
  logoutGithub,
  openExternalUrl,
} from '../window/github-auth.js';
import { Avatar, userAvatarSrc } from './primitives.js';

export interface AccountMenuProps {
  /** Close the popover (parent owns open state so the rail button can toggle / aria-expand). */
  onClose: () => void;
}

export function AccountMenu({ onClose }: AccountMenuProps): ReactNode {
  const lang = useUiStore((s) => s.localPrefs.language);
  const prefs = useUiStore((s) => s.localPrefs);
  const setLocalPrefs = useUiStore((s) => s.setLocalPrefs);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const tr = (key: Parameters<typeof t>[1]) => t(lang, key);
  const github = prefs.githubAccount;
  const displayName = (github?.name || github?.login || prefs.displayName).trim();
  const [signingIn, setSigningIn] = useState(false);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    const onPointer = (event: MouseEvent): void => {
      const target = event.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target)) return;
      // Clicks on the account mark itself are handled by the rail (toggle); ignore them here
      // so the parent can close without us racing a second close.
      const accountBtn = (target as Element).closest?.('[data-rail-account]');
      if (accountBtn) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    // Bubble phase so the rail button's click that opened us still finishes first.
    window.addEventListener('mousedown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onPointer);
    };
  }, [onClose]);

  async function signIn(): Promise<void> {
    setBusy(true);
    setNote('');
    try {
      const result = await loginWithGithubToken(token);
      if (!result.ok) {
        const map: Record<string, Parameters<typeof t>[1]> = {
          'empty-token': 'account.github.error.empty',
          unauthorized: 'account.github.error.unauthorized',
          offline: 'account.github.error.offline',
          malformed: 'account.github.error.malformed',
        };
        setNote(tr(map[result.error] ?? 'account.github.error.generic'));
        return;
      }
      setLocalPrefs({
        githubAccount: result.profile,
        displayName: prefs.displayName.trim() ? prefs.displayName : result.profile.name,
      });
      setToken('');
      setSigningIn(false);
      setNote(tr('account.github.signedIn'));
    } finally {
      setBusy(false);
    }
  }

  function signOut(): void {
    logoutGithub();
    setLocalPrefs({ githubAccount: null });
    setNote(tr('account.github.signedOut'));
    setSigningIn(false);
  }

  function openAccountSettings(): void {
    onClose();
    setSettingsOpen(true, 'account');
  }

  function openFeedback(): void {
    onClose();
    setSettingsOpen(true, 'feedback');
  }

  return (
    <div
      ref={panelRef}
      role="menu"
      aria-labelledby={titleId}
      data-account-menu
      className="absolute bottom-10 left-full z-[60] ml-2 w-[280px] overflow-hidden rounded-lg border border-line bg-elevated shadow-2xl"
    >
      <div className="flex items-center gap-3 border-b border-line px-3 py-3" data-account-menu-header>
        <Avatar kind="user" size={36} src={userAvatarSrc(prefs.userAvatar, github)} />
        <div className="min-w-0 flex-1">
          <p id={titleId} className="truncate text-[13px] font-semibold text-ink">
            {displayName || tr('account.menu.signedOut')}
          </p>
          <p className="truncate font-mono text-[11px] text-ink-3">
            {github ? `@${github.login}` : tr('account.menu.signedOutHint')}
          </p>
        </div>
      </div>

      <div className="p-1.5">
        {github ? (
          <button
            type="button"
            role="menuitem"
            data-account-menu-logout
            className="flex w-full items-center rounded-md px-2.5 py-2 text-left text-[12.5px] text-ink-2 hover:bg-hover hover:text-ink"
            onClick={() => {
              signOut();
            }}
          >
            {tr('account.github.logout')}
          </button>
        ) : signingIn ? (
          <div className="space-y-2 rounded-md border border-line bg-base/40 p-2.5" data-account-menu-signin>
            <button
              type="button"
              data-account-menu-open-token
              className="w-full rounded-md border border-line px-2 py-1.5 text-left text-[12px] text-ink-2 hover:border-accent/40 hover:text-accent"
              onClick={() => {
                void openExternalUrl(GITHUB_CLASSIC_TOKEN_URL).then((err) => {
                  if (err) setNote(err);
                });
              }}
            >
              {tr('account.github.openTokenPage')}
            </button>
            <label className="block text-[11px] text-ink-3">
              {tr('account.github.token')}
              <input
                type="password"
                autoComplete="off"
                aria-label={tr('account.github.token')}
                data-account-menu-token
                className="mt-1 w-full rounded-md border border-line bg-elevated px-2 py-1.5 font-mono text-[12px] text-ink"
                value={token}
                placeholder="ghp_…"
                onChange={(event) => setToken(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && token.trim() && !busy) {
                    event.preventDefault();
                    void signIn();
                  }
                }}
              />
            </label>
            <div className="flex gap-1.5">
              <button
                type="button"
                data-account-menu-login
                disabled={busy || !token.trim()}
                className="flex-1 rounded-md border border-accent/40 bg-accent/10 px-2 py-1.5 text-[12px] text-accent hover:bg-accent/15 disabled:opacity-40"
                onClick={() => {
                  void signIn();
                }}
              >
                {tr('account.github.login')}
              </button>
              <button
                type="button"
                data-account-menu-cancel-signin
                className="rounded-md border border-line px-2 py-1.5 text-[12px] text-ink-3 hover:text-ink"
                onClick={() => {
                  setSigningIn(false);
                  setToken('');
                  setNote('');
                }}
              >
                {tr('account.menu.cancel')}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            role="menuitem"
            data-account-menu-signin-start
            className="flex w-full items-center rounded-md px-2.5 py-2 text-left text-[12.5px] text-ink-2 hover:bg-hover hover:text-ink"
            onClick={() => {
              setSigningIn(true);
              setNote('');
            }}
          >
            {tr('account.github.login')}
          </button>
        )}

        <button
          type="button"
          role="menuitem"
          data-account-menu-feedback
          className="mt-0.5 flex w-full items-center rounded-md px-2.5 py-2 text-left text-[12.5px] text-ink-2 hover:bg-hover hover:text-ink"
          onClick={openFeedback}
        >
          {tr('account.menu.feedback')}
        </button>
        <button
          type="button"
          role="menuitem"
          data-account-menu-settings
          className="mt-0.5 flex w-full items-center rounded-md px-2.5 py-2 text-left text-[12.5px] text-ink-2 hover:bg-hover hover:text-ink"
          onClick={openAccountSettings}
        >
          {tr('account.menu.openSettings')}
        </button>
      </div>

      {note ? (
        <p className="border-t border-line px-3 py-2 text-[11.5px] text-ink-2" data-account-menu-note>
          {note}
        </p>
      ) : null}
    </div>
  );
}

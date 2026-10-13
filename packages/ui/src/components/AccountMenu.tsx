/**
 * VS Code–style Accounts popover, anchored to the icon-rail account mark.
 *
 * The mark used to open Settings on the account page. That jumps the whole shell into a
 * full drawer for what is usually a two-click job (see who is signed in / sign out). This
 * menu stays next to the avatar: identity, GitHub sign-in / sign-out, and one optional
 * "Account settings…" that still opens the Settings account section when the user wants the
 * longer form (display name, advanced token paste).
 *
 * Sign-in primary path is GitHub OAuth **device flow** (user code + browser), matching VS
 * Code. PAT paste is demoted under an advanced disclosure.
 * @module
 */

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

import { t } from '../i18n/strings.js';
import { useUiStore } from '../state/UiProvider.js';
import {
  GITHUB_CLASSIC_TOKEN_URL,
  GITHUB_OAUTH_APP_NEW_URL,
  loginWithGithubDeviceFlow,
  loginWithGithubToken,
  logoutGithub,
  openExternalUrl,
  readGithubOAuthClientId,
  writeGithubOAuthClientId,
  type GithubDeviceCode,
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
  const [usePat, setUsePat] = useState(false);
  const [token, setToken] = useState('');
  const [clientIdDraft, setClientIdDraft] = useState(() => readGithubOAuthClientId());
  const [device, setDevice] = useState<GithubDeviceCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const titleId = useId();

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        abortRef.current?.abort();
        onClose();
      }
    };
    const onPointer = (event: MouseEvent): void => {
      const target = event.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target)) return;
      const accountBtn = (target as Element).closest?.('[data-rail-account]');
      if (accountBtn) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onPointer);
      abortRef.current?.abort();
    };
  }, [onClose]);

  function mapError(error: string): Parameters<typeof t>[1] {
    const map: Record<string, Parameters<typeof t>[1]> = {
      'empty-token': 'account.github.error.empty',
      unauthorized: 'account.github.error.unauthorized',
      offline: 'account.github.error.offline',
      malformed: 'account.github.error.malformed',
      'missing-client-id': 'account.github.error.missingClientId',
      expired: 'account.github.error.expired',
      denied: 'account.github.error.denied',
      cancelled: 'account.github.error.cancelled',
    };
    return map[error] ?? 'account.github.error.generic';
  }

  async function signInWithDevice(): Promise<void> {
    if (clientIdDraft.trim() && clientIdDraft.trim() !== readGithubOAuthClientId()) {
      writeGithubOAuthClientId(clientIdDraft.trim());
    }
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    setNote('');
    setDevice(null);
    setSigningIn(true);
    setUsePat(false);
    try {
      const result = await loginWithGithubDeviceFlow({
        signal: ac.signal,
        onUserCode: (d) => setDevice(d),
      });
      if (!result.ok) {
        if (result.cancelled) {
          setNote(tr('account.github.error.cancelled'));
          return;
        }
        setNote(tr(mapError(result.error)));
        return;
      }
      setLocalPrefs({
        githubAccount: result.profile,
        displayName: prefs.displayName.trim() ? prefs.displayName : result.profile.name,
      });
      setSigningIn(false);
      setDevice(null);
      setNote(tr('account.github.signedIn'));
    } finally {
      setBusy(false);
    }
  }

  async function signInWithPat(): Promise<void> {
    setBusy(true);
    setNote('');
    try {
      const result = await loginWithGithubToken(token);
      if (!result.ok) {
        setNote(tr(mapError(result.error)));
        return;
      }
      setLocalPrefs({
        githubAccount: result.profile,
        displayName: prefs.displayName.trim() ? prefs.displayName : result.profile.name,
      });
      setToken('');
      setSigningIn(false);
      setUsePat(false);
      setNote(tr('account.github.signedIn'));
    } finally {
      setBusy(false);
    }
  }

  function signOut(): void {
    abortRef.current?.abort();
    logoutGithub();
    setLocalPrefs({ githubAccount: null });
    setNote(tr('account.github.signedOut'));
    setSigningIn(false);
    setDevice(null);
    setUsePat(false);
  }

  function cancelSignIn(): void {
    abortRef.current?.abort();
    setSigningIn(false);
    setDevice(null);
    setUsePat(false);
    setToken('');
    setNote('');
    setBusy(false);
  }

  function openAccountSettings(): void {
    onClose();
    setSettingsOpen(true, 'account');
  }

  function openFeedback(): void {
    onClose();
    setSettingsOpen(true, 'feedback');
  }

  const needsClientId = !readGithubOAuthClientId() && !clientIdDraft.trim();

  return (
    <div
      ref={panelRef}
      role="menu"
      aria-labelledby={titleId}
      data-account-menu
      className="absolute bottom-10 left-full z-[60] ml-2 w-[300px] overflow-hidden rounded-lg border border-line bg-elevated shadow-2xl"
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
            {usePat ? (
              <>
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
                        void signInWithPat();
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
                      void signInWithPat();
                    }}
                  >
                    {tr('account.github.login')}
                  </button>
                  <button
                    type="button"
                    data-account-menu-cancel-signin
                    className="rounded-md border border-line px-2 py-1.5 text-[12px] text-ink-3 hover:text-ink"
                    onClick={cancelSignIn}
                  >
                    {tr('account.menu.cancel')}
                  </button>
                </div>
                <button
                  type="button"
                  data-account-menu-use-device
                  className="w-full text-left text-[11px] text-ink-3 hover:text-accent"
                  onClick={() => {
                    setUsePat(false);
                    void signInWithDevice();
                  }}
                >
                  {tr('account.github.useDeviceFlow')}
                </button>
              </>
            ) : (
              <>
                {needsClientId ? (
                  <div className="space-y-1.5" data-account-menu-client-id>
                    <p className="text-[11px] leading-4 text-ink-3">{tr('account.github.clientIdHint')}</p>
                    <button
                      type="button"
                      data-account-menu-open-oauth-app
                      className="w-full rounded-md border border-line px-2 py-1.5 text-left text-[12px] text-ink-2 hover:border-accent/40 hover:text-accent"
                      onClick={() => {
                        void openExternalUrl(GITHUB_OAUTH_APP_NEW_URL).then((err) => {
                          if (err) setNote(err);
                        });
                      }}
                    >
                      {tr('account.github.openOauthAppPage')}
                    </button>
                    <label className="block text-[11px] text-ink-3">
                      {tr('account.github.clientId')}
                      <input
                        type="text"
                        autoComplete="off"
                        data-account-menu-client-id-input
                        className="mt-1 w-full rounded-md border border-line bg-elevated px-2 py-1.5 font-mono text-[12px] text-ink"
                        value={clientIdDraft}
                        placeholder="Ov23…"
                        onChange={(event) => setClientIdDraft(event.target.value)}
                      />
                    </label>
                  </div>
                ) : null}
                {device ? (
                  <div className="space-y-1.5 text-center" data-account-menu-device>
                    <p className="text-[11px] text-ink-3">{tr('account.github.deviceCodeHint')}</p>
                    <p
                      data-account-menu-user-code
                      className="select-all font-mono text-[22px] font-semibold tracking-[0.12em] text-ink"
                    >
                      {device.userCode}
                    </p>
                    <button
                      type="button"
                      data-account-menu-open-verify
                      className="w-full rounded-md border border-accent/40 bg-accent/10 px-2 py-1.5 text-[12px] text-accent hover:bg-accent/15"
                      onClick={() => {
                        void openExternalUrl(device.verificationUri);
                      }}
                    >
                      {tr('account.github.openBrowser')}
                    </button>
                    <p className="text-[11px] text-ink-3" data-account-menu-device-status>
                      {busy ? tr('account.github.waiting') : tr('account.github.deviceCodeHint')}
                    </p>
                  </div>
                ) : (
                  <button
                    type="button"
                    data-account-menu-login
                    disabled={busy || (!readGithubOAuthClientId() && !clientIdDraft.trim())}
                    className="w-full rounded-md border border-accent/40 bg-accent/10 px-2 py-1.5 text-[12px] text-accent hover:bg-accent/15 disabled:opacity-40"
                    onClick={() => {
                      void signInWithDevice();
                    }}
                  >
                    {tr('account.github.login')}
                  </button>
                )}
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    data-account-menu-cancel-signin
                    className="flex-1 rounded-md border border-line px-2 py-1.5 text-[12px] text-ink-3 hover:text-ink"
                    onClick={cancelSignIn}
                  >
                    {tr('account.menu.cancel')}
                  </button>
                </div>
                <button
                  type="button"
                  data-account-menu-use-pat
                  className="w-full text-left text-[11px] text-ink-3 hover:text-accent"
                  onClick={() => {
                    abortRef.current?.abort();
                    setBusy(false);
                    setDevice(null);
                    setUsePat(true);
                  }}
                >
                  {tr('account.github.usePat')}
                </button>
              </>
            )}
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
              setUsePat(false);
              void signInWithDevice();
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

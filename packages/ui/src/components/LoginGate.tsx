/**
 * First-launch sign-in.
 *
 * GitHub device flow is the same path the account menu uses. Skipping leaves
 * the guest account menu and writes a flag so the page does not return.
 * @module
 */

import { useRef, useState, type ReactNode } from 'react';

import { t } from '../i18n/strings.js';
import { useUiStore } from '../state/UiProvider.js';
import { markLoginGatePassed } from '../window/login-gate.js';
import {
  loginWithGithubDeviceFlow,
  openExternalUrl,
  readGithubOAuthClientId,
  writeGithubOAuthClientId,
  type GithubDeviceCode,
} from '../window/github-auth.js';
import { Mascot } from './primitives.js';

export function LoginGate({ onPassed }: { onPassed: () => void }): ReactNode {
  const lang = useUiStore((s) => s.localPrefs.language);
  const prefs = useUiStore((s) => s.localPrefs);
  const setLocalPrefs = useUiStore((s) => s.setLocalPrefs);
  const tr = (key: Parameters<typeof t>[1]) => t(lang, key);
  const [busy, setBusy] = useState(false);
  const [device, setDevice] = useState<GithubDeviceCode | null>(null);
  const [note, setNote] = useState('');
  const [clientIdDraft, setClientIdDraft] = useState(() => readGithubOAuthClientId());
  const abortRef = useRef<AbortController | null>(null);

  function pass(): void {
    abortRef.current?.abort();
    markLoginGatePassed();
    onPassed();
  }

  async function signIn(): Promise<void> {
    if (clientIdDraft.trim()) writeGithubOAuthClientId(clientIdDraft.trim());
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    setNote('');
    setDevice(null);
    try {
      const result = await loginWithGithubDeviceFlow({
        signal: ac.signal,
        onUserCode: (next) => setDevice(next),
      });
      if (!result.ok) {
        setNote(result.error);
        return;
      }
      setLocalPrefs({
        githubAccount: result.profile,
        displayName: prefs.displayName.trim() ? prefs.displayName : result.profile.name,
      });
      pass();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      data-login-gate
      className="absolute inset-0 z-[70] flex items-center justify-center bg-base px-6"
    >
      <div className="w-full max-w-sm text-center">
        <Mascot size={72} alt="Camelia" className="mx-auto" />
        <h1 className="mt-4 text-[18px] font-medium text-ink">{tr('login.title')}</h1>
        <p className="mt-1.5 text-[13px] leading-5 text-ink-3">{tr('login.body')}</p>
        <label className="mt-5 block text-left text-[11.5px] text-ink-3">
          {tr('account.github.clientId')}
          <input
            data-login-client-id
            value={clientIdDraft}
            onChange={(event) => setClientIdDraft(event.target.value)}
            className="mt-1 w-full rounded-md border border-line bg-elevated px-2 py-1.5 font-mono text-[12px] text-ink outline-none focus:border-ink-3"
            spellCheck={false}
            autoCapitalize="off"
          />
        </label>
        <button
          type="button"
          data-login-github
          disabled={busy}
          className="mt-3 w-full rounded-lg bg-accent px-3 py-2 text-[13px] font-medium text-white hover:bg-accent-2 disabled:opacity-60"
          onClick={() => void signIn()}
        >
          {tr('login.github')}
        </button>
        {device ? (
          <div className="mt-3 rounded-md border border-line px-3 py-2 text-left text-[12px] text-ink-2" data-login-device>
            <p className="font-mono text-[14px] text-ink">{device.userCode}</p>
            <button
              type="button"
              className="mt-1 text-accent hover:underline"
              onClick={() => void openExternalUrl(device.verificationUri)}
            >
              {tr('account.github.openBrowser')}
            </button>
          </div>
        ) : null}
        {note ? <p className="mt-2 text-[12px] text-warn">{note}</p> : null}
        <button
          type="button"
          data-login-skip
          className="mt-4 text-[12.5px] text-ink-3 hover:text-ink hover:underline"
          onClick={pass}
        >
          {tr('login.skip')}
        </button>
      </div>
    </div>
  );
}

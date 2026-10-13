/**
 * Settings page — multi-section shell opened from the left rail.
 *
 * Sections (wireframe v2): connection presets, language & appearance, engine & logs, about.
 * Connection presets live in ConnectionsSection (config.json providers[] + keys.json).
 *
 * The active section is *not* local state: the rail has two doors into this drawer — the
 * settings gear and the account mark — and they are supposed to land on different pages, so
 * the caller has to be able to name one. See `UiState.setSettingsOpen`.
 * @module
 */

import { useEffect, useState, type ReactNode } from 'react';

import { makeCommand, type SettingsSection } from '../state/store.js';
import { useUiStore } from '../state/UiProvider.js';
import { type LanguagePref, type MotionPref, type TopBarMode, type UserAvatarMode } from '../state/local-prefs.js';
import { t } from '../i18n/strings.js';
import { THEME_PRESETS, type ThemeId } from '../theme/presets.js';
import { relaunchDesktop, writePlanApproval } from '../window/model-settings.js';
import { ConnectionsSection } from './ConnectionsSection.js';
import { FeedbackForm } from './FeedbackForm.js';
import { MODE_REGISTRY } from '../mode/ModeRegistry.js';
import type { AppModeId } from '../mode/types.js';
import { openEngineLog, readEngineLog, readEngineTrust } from '../window/engine.js';
import { isTauri } from '../window/shell.js';
import { Avatar, Icon, userAvatarSrc } from './primitives.js';
import {
  GITHUB_CLASSIC_TOKEN_URL,
  loginWithGithubToken,
  logoutGithub,
  openExternalUrl,
} from '../window/github-auth.js';

const MONO_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'JetBrains Mono' },
  { value: "'Cascadia Mono', Consolas, monospace", label: 'Cascadia Mono' },
  { value: 'Consolas, monospace', label: 'Consolas' },
];

const NO_REJECTIONS: Array<{ token: string; reason: string }> = [];


export function SettingsDrawer(): ReactNode {
  const open = useUiStore((s) => s.settingsOpen);
  const prefs = useUiStore((s) => s.localPrefs);
  const rejected = useUiStore((s) => s.activeTheme?.rejected) ?? NO_REJECTIONS;
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const setSettingsSection = useUiStore((s) => s.setSettingsSection);
  const tr = (key: Parameters<typeof t>[1]) => t(prefs.language, key);
  const section = useUiStore((s) => s.settingsSection);

  if (!open) return null;

  const nav: Array<{ id: SettingsSection; label: string; icon: string }> = [
    { id: 'account', label: tr('settings.section.account'), icon: 'user' },
    { id: 'connections', label: tr('settings.section.connections'), icon: 'layers' },
    { id: 'appearance', label: tr('settings.section.appearance'), icon: 'theme' },
    { id: 'engine', label: tr('settings.section.engine'), icon: 'terminal' },
    { id: 'feedback', label: tr('feedback.title'), icon: 'chat' },
    { id: 'about', label: tr('settings.section.about'), icon: 'info' },
  ];

  return (
    <div className="absolute inset-0 z-50 flex items-stretch justify-center bg-base/55 p-4 sm:p-6" data-settings-page>
      <button type="button" aria-label={tr('settings.close')} className="absolute inset-0 cursor-default" onClick={() => setSettingsOpen(false)} />
      <div className="relative flex h-full w-full max-w-[920px] overflow-hidden rounded-xl border border-line bg-elevated shadow-2xl">
        <nav className="flex w-[200px] shrink-0 flex-col border-r border-line bg-base/40" aria-label={tr('settings.title')}>
          <div className="flex items-center gap-2 border-b border-line px-3 py-3">
            <Avatar kind="agent" size={28} />
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold text-ink">{tr('settings.title')}</p>
              <p className="truncate text-[10.5px] text-ink-3">{tr('brand.placeholder')}</p>
            </div>
          </div>
          <ul className="flex-1 space-y-0.5 p-2">
            {nav.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  data-settings-nav={item.id}
                  className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12.5px] ${
                    section === item.id ? 'bg-accent/10 font-medium text-accent' : 'text-ink-2 hover:bg-hover hover:text-ink'
                  }`}
                  onClick={() => setSettingsSection(item.id)}
                >
                  <Icon name={item.icon} size={14} />
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-[14px] font-semibold text-ink">{nav.find((n) => n.id === section)?.label}</h2>
            <button
              type="button"
              aria-label={tr('settings.close')}
              className="grid h-7 w-7 place-items-center rounded text-ink-3 hover:bg-hover hover:text-ink"
              onClick={() => setSettingsOpen(false)}
            >
              <Icon name="x" size={14} />
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {rejected.length > 0 && section === 'appearance' ? (
              <div className="mb-4 rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-[12px] text-bad">
                <p className="font-medium">{rejected.length} {tr('settings.tokenRejected')}</p>
                <ul className="mt-1 space-y-1">
                  {rejected.map((item) => (
                    <li key={`${item.token}-${item.reason}`}>
                      <span className="font-mono">{item.token}</span> — {item.reason}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {section === 'account' ? <AccountSection tr={tr} /> : null}
            {section === 'connections' ? <ConnectionsSection tr={tr} /> : null}
            {section === 'appearance' ? <AppearanceSection tr={tr} /> : null}
            {section === 'engine' ? <EngineSection tr={tr} /> : null}
            {section === 'feedback' ? (
        <FeedbackForm
          onNeedLogin={() => {
            setSettingsSection('account');
          }}
        />
      ) : null}
      {section === 'about' ? <AboutSection tr={tr} /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}


function AccountSection({ tr }: { tr: (key: Parameters<typeof t>[1]) => string }): ReactNode {
  const prefs = useUiStore((s) => s.localPrefs);
  const setLocalPrefs = useUiStore((s) => s.setLocalPrefs);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const github = prefs.githubAccount;

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
      setNote(tr('account.github.signedIn'));
    } finally {
      setBusy(false);
    }
  }

  function signOut(): void {
    logoutGithub();
    setLocalPrefs({ githubAccount: null });
    setNote(tr('account.github.signedOut'));
  }

  return (
    <div className="space-y-5" data-account-section>
      <section className="space-y-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-3">{tr('account.github.title')}</h3>
        <p className="text-[12px] leading-5 text-ink-2">{tr('account.github.hint')}</p>
        {github ? (
          <div className="flex items-center gap-3 rounded-lg border border-line bg-base/50 px-3 py-2.5" data-github-profile>
            <Avatar kind="user" size={40} src={userAvatarSrc(prefs.userAvatar, github)} title={github.login} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-ink">{github.name}</p>
              <p className="truncate font-mono text-[11px] text-ink-3">@{github.login}</p>
            </div>
            <button
              type="button"
              data-github-logout
              className="rounded-md border border-line px-2.5 py-1.5 text-[12px] text-ink-2 hover:border-bad/40 hover:text-bad"
              onClick={() => signOut()}
            >
              {tr('account.github.logout')}
            </button>
          </div>
        ) : (
          <div className="space-y-2 rounded-lg border border-line bg-base/50 p-3" data-github-login>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                data-github-open-token
                className="rounded-md border border-line px-2.5 py-1.5 text-[12px] text-ink-2 hover:border-accent/40 hover:text-accent"
                onClick={() => {
                  void openExternalUrl(GITHUB_CLASSIC_TOKEN_URL).then((err) => {
                    if (err) setNote(err);
                  });
                }}
              >
                {tr('account.github.openTokenPage')}
              </button>
            </div>
            <label className="block text-[12px] text-ink-2">
              {tr('account.github.token')}
              <input
                type="password"
                autoComplete="off"
                aria-label={tr('account.github.token')}
                data-github-token
                className="mt-1 w-full rounded-md border border-line bg-elevated px-2 py-1.5 font-mono text-[12px] text-ink"
                value={token}
                placeholder="ghp_…"
                onChange={(event) => setToken(event.target.value)}
              />
            </label>
            <p className="text-[10.5px] leading-4 text-ink-3">{tr('account.github.tokenHint')}</p>
            <button
              type="button"
              data-github-login
              disabled={busy || !token.trim()}
              className="rounded-md border border-accent/40 bg-accent/10 px-2.5 py-1.5 text-[12px] text-accent hover:bg-accent/15 disabled:opacity-40"
              onClick={() => {
                void signIn();
              }}
            >
              {tr('account.github.login')}
            </button>
          </div>
        )}
        {note ? <p className="text-[12px] text-ink-2" data-github-note>{note}</p> : null}
      </section>
      <section className="space-y-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-3">{tr('settings.appearance.displayName')}</h3>
        <input
          type="text"
          maxLength={48}
          aria-label={tr('settings.appearance.displayName')}
          placeholder={github?.name || tr('account.defaultUser')}
          className="w-full rounded-md border border-line bg-base px-2 py-1.5 text-[12px] text-ink placeholder:text-ink-3"
          value={prefs.displayName}
          onChange={(event) => setLocalPrefs({ displayName: event.target.value })}
        />
        <p className="text-[10.5px] leading-4 text-ink-3">{tr('settings.appearance.displayName.hint')}</p>
      </section>
    </div>
  );
}

function AppearanceSection({ tr }: { tr: (key: Parameters<typeof t>[1]) => string }): ReactNode {
  const prefs = useUiStore((s) => s.localPrefs);
  const setLocalPrefs = useUiStore((s) => s.setLocalPrefs);
  const dispatch = useUiStore((s) => s.dispatch);
  const restoreDefaultLayout = useUiStore((s) => s.restoreDefaultLayout);

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-3">{tr('settings.appearance')}</h3>
        <label className="block text-[12px] text-ink-2">
          {tr('settings.language')}
          <select
            aria-label={tr('settings.language')}
            className="mt-1 w-full rounded-md border border-line bg-base px-2 py-1.5 text-[12px] text-ink"
            value={prefs.language}
            onChange={(event) => setLocalPrefs({ language: event.target.value as LanguagePref })}
          >
            <option value="en">{tr('lang.en')}</option>
            <option value="zh">{tr('lang.zh')}</option>
          </select>
        </label>
        <label className="block text-[12px] text-ink-2">
          {tr('settings.theme')}
          <select
            aria-label={tr('settings.theme')}
            className="mt-1 w-full rounded-md border border-line bg-base px-2 py-1.5 text-[12px] text-ink"
            value={prefs.themeId}
            onChange={(event) => setLocalPrefs({ themeId: event.target.value as ThemeId })}
          >
            {THEME_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[12px] text-ink-2">
          {tr('settings.font')}
          <select
            aria-label={tr('settings.font')}
            className="mt-1 w-full rounded-md border border-line bg-base px-2 py-1.5 text-[12px] text-ink"
            value={prefs.fontMono}
            onChange={(event) => setLocalPrefs({ fontMono: event.target.value })}
          >
            {MONO_OPTIONS.map((option) => (
              <option key={option.label} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[12px] text-ink-2">
          {tr('settings.topBar')}
          <select
            aria-label={tr('settings.topBar')}
            className="mt-1 w-full rounded-md border border-line bg-base px-2 py-1.5 text-[12px] text-ink"
            value={prefs.topBar}
            onChange={(event) => setLocalPrefs({ topBar: event.target.value as TopBarMode })}
          >
            <option value="auto">{tr('settings.topBar.auto')}</option>
            <option value="pinned">{tr('settings.topBar.pinned')}</option>
            <option value="hidden">{tr('settings.topBar.hidden')}</option>
          </select>
        </label>
        <p className="text-[10.5px] leading-4 text-ink-3">{tr('settings.topbar.alwaysOnTask.hint')}</p>
        <label className="block text-[12px] text-ink-2">
          {tr('settings.motion')}
          <select
            aria-label={tr('settings.motion')}
            className="mt-1 w-full rounded-md border border-line bg-base px-2 py-1.5 text-[12px] text-ink"
            value={prefs.motion}
            onChange={(event) => setLocalPrefs({ motion: event.target.value as MotionPref })}
          >
            <option value="system">{tr('settings.motion.system')}</option>
            <option value="reduce">{tr('settings.motion.reduce')}</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-[12px] text-ink-2">
          <input
            type="checkbox"
            aria-label={tr('settings.appearance.avatars')}
            checked={prefs.showAvatars}
            onChange={(event) => setLocalPrefs({ showAvatars: event.target.checked })}
          />
          {tr('settings.appearance.avatars')}
        </label>
        <p className="text-[10.5px] leading-4 text-ink-3">{tr('settings.appearance.avatars.hint')}</p>
        <label className="block text-[12px] text-ink-2">
          {tr('settings.appearance.userAvatar')}
          <select
            aria-label={tr('settings.appearance.userAvatar')}
            className="mt-1 w-full rounded-md border border-line bg-base px-2 py-1.5 text-[12px] text-ink"
            value={prefs.userAvatar}
            onChange={(event) => setLocalPrefs({ userAvatar: event.target.value as UserAvatarMode })}
          >
            <option value="mascot">{tr('settings.appearance.userAvatar.mascot')}</option>
            <option value="letter">{tr('settings.appearance.userAvatar.letter')}</option>
          </select>
        </label>
        <p className="text-[10.5px] leading-4 text-ink-3">{tr('settings.appearance.userAvatar.hint')}</p>
        <label className="block text-[12px] text-ink-2">
          {tr('settings.appearance.displayName')}
          <input
            type="text"
            aria-label={tr('settings.appearance.displayName')}
            maxLength={48}
            placeholder={tr('account.defaultUser')}
            className="mt-1 w-full rounded-md border border-line bg-base px-2 py-1.5 text-[12px] text-ink placeholder:text-ink-3"
            value={prefs.displayName}
            onChange={(event) => setLocalPrefs({ displayName: event.target.value })}
          />
        </label>
        <p className="text-[10.5px] leading-4 text-ink-3">{tr('settings.appearance.displayName.hint')}</p>
      </section>

      <section className="space-y-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-3">{tr('settings.modes.title')}</h3>
        <label className="block text-[12px] text-ink-2">
          {tr('settings.modes.default')}
          <select
            aria-label={tr('settings.modes.default')}
            className="mt-1 w-full rounded-md border border-line bg-base px-2 py-1.5 text-[12px] text-ink"
            value={prefs.preferredMode}
            onChange={(event) => setLocalPrefs({ preferredMode: event.target.value as AppModeId })}
          >
            {MODE_REGISTRY.map((def) => (
              <option key={def.id} value={def.id}>
                {tr(def.labelKey as Parameters<typeof t>[1])}
              </option>
            ))}
          </select>
        </label>
        <p className="text-[10.5px] leading-4 text-ink-3">{tr('settings.modes.hint')}</p>
      </section>

      <section className="space-y-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-3">{tr('settings.plans')}</h3>
        <label className="block text-[12px] text-ink-2">
          {tr('settings.planApproval')}
          <select
            aria-label={tr('settings.planApproval')}
            className="mt-1 w-full rounded-md border border-line bg-base px-2 py-1.5 text-[12px] text-ink"
            value={prefs.planApproval}
            onChange={(event) => {
              const mode = event.target.value === 'auto' ? 'auto' : 'always';
              setLocalPrefs({ planApproval: mode });
              // Two writes on purpose: the command changes the engine that is running
              // now, the disk write makes the choice survive the next launch. The shell
              // spawns a fresh engine every time, so the command alone was not durable.
              dispatch(makeCommand('set_plan_approval', { mode }));
              void writePlanApproval(mode);
            }}
          >
            <option value="always">{tr('settings.planApproval.always')}</option>
            <option value="auto">{tr('settings.planApproval.auto')}</option>
          </select>
        </label>
      </section>

      <section className="space-y-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-3">{tr('settings.layout')}</h3>
        <label className="block text-[12px] text-ink-2">
          {tr('settings.leftWidth')} ({prefs.leftWidth}px)
          <input
            aria-label={tr('settings.leftWidth')}
            type="range"
            min={200}
            max={420}
            value={prefs.leftWidth}
            className="mt-1 w-full"
            onChange={(event) => setLocalPrefs({ leftWidth: Number(event.target.value) })}
          />
        </label>
        <label className="flex items-center gap-2 text-[12px] text-ink-2">
          <input type="checkbox" checked={prefs.leftCollapsed} onChange={(event) => setLocalPrefs({ leftCollapsed: event.target.checked })} />
          {tr('settings.collapseSessions')}
        </label>
        <button
          type="button"
          className="rounded-md border border-line px-2.5 py-1.5 text-[12px] text-ink-2 hover:border-accent/40 hover:text-accent"
          onClick={() => restoreDefaultLayout()}
        >
          {tr('settings.restoreLayout')}
        </button>
        <p className="text-[10.5px] text-ink-3">{tr('settings.layoutDefaults')}</p>
      </section>
    </div>
  );
}

function EngineSection({ tr }: { tr: (key: Parameters<typeof t>[1]) => string }): ReactNode {
  const trust = readEngineTrust();
  const desktop = isTauri();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [logText, setLogText] = useState<string>('');
  const [logError, setLogError] = useState<string>('');

  useEffect(() => {
    if (!desktop) return;
    let cancelled = false;
    void readEngineLog(200).then((result) => {
      if (cancelled) return;
      if (result.error) setLogError(result.error);
      else setLogText(result.text ?? '');
    });
    return () => {
      cancelled = true;
    };
  }, [desktop]);

  return (
    <section className="space-y-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-3">{tr('settings.diagnostics')}</h3>
      {trust.expectsLiveEngine ? (
        <dl className="space-y-1.5 text-[12px] text-ink-2">
          <div>
            <dt className="text-[10.5px] uppercase tracking-[0.08em] text-ink-3">{tr('connection.engineUrl')}</dt>
            <dd className="break-all font-mono text-[11px]">{trust.engineUrl}</dd>
          </div>
          <div>
            <dt className="text-[10.5px] uppercase tracking-[0.08em] text-ink-3">{tr('connection.session')}</dt>
            <dd className="font-mono text-[11px]">{trust.sessionId || '—'}</dd>
          </div>
        </dl>
      ) : (
        <p className="text-[12px] text-ink-2">
          {tr('connection.fixture')}
          {trust.scene ? <span className="mt-1 block font-mono text-[11px] text-ink-3">{trust.scene}</span> : null}
        </p>
      )}
      {desktop ? (
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            className="rounded-md border border-line px-2.5 py-1.5 text-[12px] text-ink-2 hover:border-accent/40 hover:text-accent"
            onClick={() => {
              void openEngineLog().then((result) => setNote(result.error ?? result.path ?? ''));
            }}
          >
            {tr('settings.openEngineLog')}
          </button>
          <button
            type="button"
            className="rounded-md border border-line px-2.5 py-1.5 text-[12px] text-ink-2 hover:border-accent/40 hover:text-accent"
            onClick={() => {
              void readEngineLog(200).then((result) => {
                if (result.error) setLogError(result.error);
                else {
                  setLogError('');
                  setLogText(result.text ?? '');
                }
              });
            }}
          >
            {tr('settings.refreshEngineLog')}
          </button>
          <button
            type="button"
            disabled={busy}
            className="rounded-md border border-line px-2.5 py-1.5 text-[12px] text-ink-2 hover:border-accent/40 hover:text-accent disabled:opacity-40"
            onClick={() => {
              setBusy(true);
              void relaunchDesktop().then((error) => {
                if (error) {
                  setNote(error);
                  setBusy(false);
                }
              });
            }}
          >
            {tr('settings.restartDesktop')}
          </button>
        </div>
      ) : (
        <p className="text-[12px] text-ink-3">{tr('settings.engine.browserHint')}</p>
      )}
      {note ? <p className="break-all font-mono text-[11px] text-ink-3">{note}</p> : null}
      <div className="space-y-1.5">
        <h4 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-3">{tr('settings.engineLog')}</h4>
        {logError ? <p className="text-[12px] text-ink-3">{logError}</p> : null}
        <pre
          data-engine-log
          className="max-h-64 overflow-auto rounded-md border border-line bg-base/60 p-2 font-mono text-[10.5px] leading-4 text-ink-2"
        >
          {logText || tr('settings.engineLog.empty')}
        </pre>
      </div>
    </section>
  );
}

function AboutSection({ tr }: { tr: (key: Parameters<typeof t>[1]) => string }): ReactNode {
  const boot = typeof window !== 'undefined' ? (window as unknown as { __CAMELIA_BOOT__?: { commit?: string; version?: string } }).__CAMELIA_BOOT__ : undefined;
  const version = boot?.version || '0.1.0';
  const commit = boot?.commit || 'f5592c3';
  return (
    <section className="space-y-2" data-about-version>
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-3">{tr('settings.about')}</h3>
      <p className="text-[12px] text-ink-2">Camelia {version}</p>
      <p className="font-mono text-[11px] text-ink-3">{tr('settings.about.commit')}: {commit}</p>
      <p className="text-[12px] text-ink-3">{tr('brand.placeholder')}</p>
      <p className="font-mono text-[12px] text-ink-2">~/.camelia</p>
      <p className="text-[12px] text-ink-3">{tr('settings.about.preface')}</p>
      <p className="text-[12px] text-ink-3">{tr('settings.about.license')}</p>
    </section>
  );
}


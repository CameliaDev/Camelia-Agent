/**
 * Settings drawer. It hangs off the right rail so the conversation stays put.
 * @module
 */

import type { ReactNode } from 'react';

import { makeCommand } from '../state/store.js';
import { useUiStore } from '../state/UiProvider.js';
import { type LanguagePref, type MotionPref, type TopBarMode } from '../state/local-prefs.js';
import { t } from '../i18n/strings.js';
import { THEME_PRESETS, type ThemeId } from '../theme/presets.js';
import { Icon } from './primitives.js';

const NO_REJECTIONS: Array<{ token: string; reason: string }> = [];

const MONO_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'JetBrains Mono' },
  { value: "'Cascadia Mono', Consolas, monospace", label: 'Cascadia Mono' },
  { value: 'Consolas, monospace', label: 'Consolas' },
];

export function SettingsDrawer(): ReactNode {
  const open = useUiStore((s) => s.settingsOpen);
  const prefs = useUiStore((s) => s.localPrefs);
  const rejected = useUiStore((s) => s.activeTheme?.rejected) ?? NO_REJECTIONS;
  const setLocalPrefs = useUiStore((s) => s.setLocalPrefs);
  const dispatch = useUiStore((s) => s.dispatch);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const restoreDefaultLayout = useUiStore((s) => s.restoreDefaultLayout);
  const tr = (key: Parameters<typeof t>[1]) => t(prefs.language, key);

  if (!open) return null;

  return (
    <div className="absolute inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label={tr('settings.close')}
        className="absolute inset-0 bg-base/40"
        onClick={() => setSettingsOpen(false)}
      />
      <aside className="relative flex h-full w-[400px] max-w-[420px] min-w-[360px] flex-col border-l border-line bg-elevated shadow-xl">
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-[13px] font-semibold text-ink">{tr('settings.title')}</h2>
          <button
            type="button"
            aria-label="Close"
            className="grid h-7 w-7 place-items-center rounded text-ink-3 hover:bg-hover hover:text-ink"
            onClick={() => setSettingsOpen(false)}
          >
            <Icon name="x" size={14} />
          </button>
        </header>
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-4">
          {rejected.length > 0 ? (
            <div className="rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-[12px] text-bad">
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
                  dispatch(makeCommand('set_plan_approval', { mode }));
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
            <label className="block text-[12px] text-ink-2">
              {tr('settings.rightWidth')} ({prefs.rightWidth}px)
              <input
                aria-label={tr('settings.rightWidth')}
                type="range"
                min={280}
                max={560}
                value={prefs.rightWidth}
                className="mt-1 w-full"
                onChange={(event) => setLocalPrefs({ rightWidth: Number(event.target.value) })}
              />
            </label>
            <label className="flex items-center gap-2 text-[12px] text-ink-2">
              <input
                type="checkbox"
                checked={prefs.leftCollapsed}
                onChange={(event) => setLocalPrefs({ leftCollapsed: event.target.checked })}
              />
              {tr('settings.collapseSessions')}
            </label>
            <label className="flex items-center gap-2 text-[12px] text-ink-2">
              <input
                type="checkbox"
                checked={prefs.rightCollapsed}
                onChange={(event) => setLocalPrefs({ rightCollapsed: event.target.checked })}
              />
              {tr('settings.collapseRunRail')}
            </label>
            <button
              type="button"
              className="rounded-md border border-line px-2.5 py-1.5 text-[12px] text-ink-2 hover:border-accent/40 hover:text-accent"
              onClick={() => restoreDefaultLayout()}
            >
              {tr('settings.restoreLayout')}
            </button>
            <p className="text-[10.5px] text-ink-3">
              {tr('settings.layoutDefaults')}
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-3">{tr('settings.about')}</h3>
            <p className="text-[12px] text-ink-2">Camelia 0.1.0</p>
            <p className="font-mono text-[12px] text-ink-2">~/.camelia</p>
            <p className="text-[12px] text-ink-3">{tr('settings.about.preface')}</p>
            <p className="text-[12px] text-ink-3">{tr('settings.about.license')}</p>
          </section>
        </div>
      </aside>
    </div>
  );
}

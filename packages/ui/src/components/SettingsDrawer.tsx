/**
 * Settings drawer. It hangs off the right rail so the conversation stays put.
 * @module
 */

import type { ReactNode } from 'react';

import { makeCommand } from '../state/store.js';
import { useUiStore } from '../state/UiProvider.js';
import { RAIL_LEFT_DEFAULT, RAIL_RIGHT_DEFAULT, type MotionPref, type TopBarMode } from '../state/local-prefs.js';
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

  if (!open) return null;

  return (
    <div className="absolute inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close settings"
        className="absolute inset-0 bg-base/40"
        onClick={() => setSettingsOpen(false)}
      />
      <aside className="relative flex h-full w-[400px] max-w-[420px] min-w-[360px] flex-col border-l border-line bg-elevated shadow-xl">
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-[13px] font-semibold text-ink">Settings</h2>
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
              <p className="font-medium">{rejected.length} token rejected</p>
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
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-3">Appearance</h3>
            <label className="block text-[12px] text-ink-2">
              Theme
              <select
                aria-label="Theme"
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
              Font
              <select
                aria-label="Font"
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
              Top bar
              <select
                aria-label="Top bar"
                className="mt-1 w-full rounded-md border border-line bg-base px-2 py-1.5 text-[12px] text-ink"
                value={prefs.topBar}
                onChange={(event) => setLocalPrefs({ topBar: event.target.value as TopBarMode })}
              >
                <option value="auto">Show on hover</option>
                <option value="pinned">Always visible</option>
                <option value="hidden">Hidden until shortcut</option>
              </select>
            </label>
            <label className="block text-[12px] text-ink-2">
              Motion
              <select
                aria-label="Motion"
                className="mt-1 w-full rounded-md border border-line bg-base px-2 py-1.5 text-[12px] text-ink"
                value={prefs.motion}
                onChange={(event) => setLocalPrefs({ motion: event.target.value as MotionPref })}
              >
                <option value="system">Follow system</option>
                <option value="reduce">Reduce motion</option>
              </select>
            </label>
          </section>

          <section className="space-y-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-3">Plans</h3>
            <label className="block text-[12px] text-ink-2">
              Plan approval
              <select
                aria-label="Plan approval"
                className="mt-1 w-full rounded-md border border-line bg-base px-2 py-1.5 text-[12px] text-ink"
                value={prefs.planApproval}
                onChange={(event) => {
                  const mode = event.target.value === 'auto' ? 'auto' : 'always';
                  setLocalPrefs({ planApproval: mode });
                  dispatch(makeCommand('set_plan_approval', { mode }));
                }}
              >
                <option value="always">Ask before every plan</option>
                <option value="auto">Approve plans automatically</option>
              </select>
            </label>
          </section>

          <section className="space-y-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-3">Layout</h3>
            <label className="block text-[12px] text-ink-2">
              Left width ({prefs.leftWidth}px)
              <input
                aria-label="Left width"
                type="range"
                min={200}
                max={420}
                value={prefs.leftWidth}
                className="mt-1 w-full"
                onChange={(event) => setLocalPrefs({ leftWidth: Number(event.target.value) })}
              />
            </label>
            <label className="block text-[12px] text-ink-2">
              Right width ({prefs.rightWidth}px)
              <input
                aria-label="Right width"
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
              Start with sessions collapsed
            </label>
            <label className="flex items-center gap-2 text-[12px] text-ink-2">
              <input
                type="checkbox"
                checked={prefs.rightCollapsed}
                onChange={(event) => setLocalPrefs({ rightCollapsed: event.target.checked })}
              />
              Start with the run rail collapsed
            </label>
            <button
              type="button"
              className="rounded-md border border-line px-2.5 py-1.5 text-[12px] text-ink-2 hover:border-accent/40 hover:text-accent"
              onClick={() => restoreDefaultLayout()}
            >
              Restore default layout
            </button>
            <p className="text-[10.5px] text-ink-3">
              Defaults are {RAIL_LEFT_DEFAULT}px and {RAIL_RIGHT_DEFAULT}px, both expanded.
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-3">About</h3>
            <p className="text-[12px] text-ink-2">Camelia 0.1.0</p>
            <p className="font-mono text-[12px] text-ink-2">~/.camelia</p>
            <p className="text-[12px] text-ink-3">API keys stay in ~/.camelia. This app sends no telemetry.</p>
            <p className="text-[12px] text-ink-3">Apache-2.0</p>
          </section>
        </div>
      </aside>
    </div>
  );
}

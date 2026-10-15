/**
 * Reading and switching the active mode.
 *
 * The active mode is **ephemeral chrome** (same class as `settingsOpen`), while the
 * *preferred* mode is a window preference persisted via `localPrefs`. Two fields, two
 * lifetimes, deliberately:
 *
 * - `ui.mode`   — what this window is showing right now. Not persisted; resets to the
 *                 preferred mode on the next boot.
 * - `localPrefs.preferredMode` — the mode a new session should open in. Persisted, and
 *                 sanitised through `sanitizeLocalPrefs` like every other pref.
 *
 * Neither is ever written into `snapshot`, because neither is a fact about the task.
 * @module
 */

import { useCallback } from 'react';

import { makeCommand } from '../state/store.js';
import { shellModeInstalled } from '../state/shell-plugins.js';
import { useUiStore, useUiStoreApi } from '../state/UiProvider.js';
import { modeDefinition } from './ModeRegistry.js';
import { projectionMatchesMode, sessionForMode } from './session-kind.js';
import { normalizeModeId, type AppModeId, type ModeDefinition } from './types.js';

export interface ModeControls {
  mode: AppModeId;
  definition: ModeDefinition;
  setMode: (id: AppModeId) => void;
  /** The mode a future session opens in — what Settings edits. */
  preferredMode: AppModeId;
  setPreferredMode: (id: AppModeId) => void;
}

export function useMode(): ModeControls {
  const mode = useUiStore((s) => s.mode);
  const setModeRaw = useUiStore((s) => s.setMode);
  const preferredMode = useUiStore((s) => s.localPrefs.preferredMode);
  const setLocalPrefs = useUiStore((s) => s.setLocalPrefs);
  const store = useUiStoreApi();

  const setMode = useCallback(
    (id: AppModeId) => {
      const next = normalizeModeId(id);
      const state = store.getState();
      if (next === 'math' && !shellModeInstalled(state.installedPlugins, 'math')) return;
      if (next === 'term') return;
      setModeRaw(next);
      // Show this mode's own session when one already exists. Do not create one:
      // a tab click must not invent a conversation or disturb a running task.
      if (projectionMatchesMode(state.snapshot, next)) return;
      const row = sessionForMode(state.sessions, next);
      if (!row || row.id === state.snapshot.session?.id) return;
      state.dispatch(makeCommand('select_session', { sessionId: row.id }));
    },
    [setModeRaw, store],
  );

  const setPreferredMode = useCallback(
    (id: AppModeId) => {
      let next = normalizeModeId(id);
      const state = store.getState();
      if (next === 'math' && !shellModeInstalled(state.installedPlugins, 'math')) next = 'work';
      if (next === 'term') next = 'work';
      // Persisting the preference also switches the window: a user who says "open in
      // plan mode" almost always means "and show me plan mode now".
      setLocalPrefs({ preferredMode: next });
      setModeRaw(next);
    },
    [setLocalPrefs, setModeRaw, store],
  );

  return {
    mode,
    definition: modeDefinition(mode),
    setMode,
    preferredMode,
    setPreferredMode,
  };
}

/**
 * Whether a task is currently in flight.
 *
 * One definition, used by the top bar's force-visible policy and by the "a task is
 * running in another mode" strip, so the two can never disagree about what "running"
 * means. `paused` counts as in flight: the user still needs to see it and resume it.
 */
export function isTaskActive(status: string | undefined): boolean {
  if (!status) return false;
  return status !== 'done' && status !== 'failed' && status !== 'cancelled';
}

/**
 * Installed shell plugins — activity-bar contributions from `list_plugins`.
 * @module
 */

import type { ShellModeId } from '@camelia/core';

import { normalizeModeId, type AppModeId } from '../mode/types.js';

export interface InstalledPluginView {
  id: string;
  name: string;
  description: string;
  kind: string;
  dir: string;
  shell?: { mode: ShellModeId; icon: string };
}

export function shellModeInstalled(plugins: readonly InstalledPluginView[], mode: ShellModeId): boolean {
  return plugins.some((plugin) => plugin.shell?.mode === mode);
}

/** Active window mode — only math requires the shell plugin. */
export function reconcileActiveMode(mode: string, plugins: readonly InstalledPluginView[]): AppModeId {
  const normalized = normalizeModeId(mode);
  if (normalized === 'math' && !shellModeInstalled(plugins, 'math')) return 'work';
  return normalized;
}

/** Persisted default mode — math needs the plugin; term is no longer offered in chrome. */
export function reconcilePreferredMode(mode: string, plugins: readonly InstalledPluginView[]): AppModeId {
  const normalized = normalizeModeId(mode);
  if (normalized === 'math' && !shellModeInstalled(plugins, 'math')) return 'work';
  if (normalized === 'term') return 'work';
  return normalized;
}

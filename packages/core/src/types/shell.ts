/**
 * Shell plugin payload — declarative UI contributions (activity bar, etc.).
 *
 * Shell plugins are data-only JSON; the desktop reads them via `list_plugins` without
 * executing plugin code. Today the only contribution is an optional workbench mode icon.
 * @module
 */

import type { PluginManifestIssue, ParseResult } from './plugins.js';

/** Modes that may be surfaced only when a shell plugin is installed. */
export const SHELL_MODES = ['math'] as const;
export type ShellModeId = (typeof SHELL_MODES)[number];

export interface ShellPlugin {
  /** Workbench mode this plugin unlocks in the activity bar. */
  mode: ShellModeId;
  /** Icon id from the shell icon set (`packages/ui` primitives). */
  icon: string;
}

const SHELL_ICONS = new Set(['sigma']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isShellModeId(value: unknown): value is ShellModeId {
  return typeof value === 'string' && (SHELL_MODES as readonly string[]).includes(value);
}

/** Validate an unknown value into a {@link ShellPlugin}. */
export function parseShellPlugin(raw: unknown): ParseResult<ShellPlugin> {
  const issues: PluginManifestIssue[] = [];
  if (!isRecord(raw)) {
    return { ok: false, issues: [{ path: '', message: 'shell entry must be a JSON object' }] };
  }

  const mode = raw.mode;
  if (!isShellModeId(mode)) {
    issues.push({ path: 'mode', message: `mode must be one of ${SHELL_MODES.join(' | ')}` });
  }

  const icon = raw.icon;
  if (typeof icon !== 'string' || !icon.trim()) {
    issues.push({ path: 'icon', message: 'icon must be a non-empty string' });
  } else if (!SHELL_ICONS.has(icon.trim())) {
    issues.push({ path: 'icon', message: `unsupported icon; allowed: ${[...SHELL_ICONS].join(' | ')}` });
  }

  if (issues.length > 0) return { ok: false, issues };

  return {
    ok: true,
    value: { mode: mode as ShellModeId, icon: (icon as string).trim() },
  };
}

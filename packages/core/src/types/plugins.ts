/**
 * Plugin manifest contract — the single shape every extension point shares.
 *
 * Four extension points (provider / tool / theme / agent-preset) all ship the same
 * `camelia.plugin.json` manifest. One manifest schema means one validator, one
 * permission model and one discovery path, instead of four of each drifting apart
 * (whitepaper §8).
 *
 * Permissions are declared, never implied: a plugin states the capabilities it
 * needs and the loader refuses anything it did not declare. A plugin that wants
 * `shell:exec` says so in a file the user can read before installing it.
 * @module
 */

import type { RiskLevel } from './domain.js';

/** The four extension points (whitepaper §8.1–§8.4). */
export const PLUGIN_KINDS = ['provider', 'tool', 'theme', 'agent-preset'] as const;
export type PluginKind = (typeof PLUGIN_KINDS)[number];

/** Capabilities a plugin may request. Nothing is granted implicitly. */
export const PLUGIN_PERMISSIONS = ['fs:read', 'fs:write', 'shell:exec', 'net'] as const;
export type PluginPermission = (typeof PLUGIN_PERMISSIONS)[number];

export interface PluginManifest {
  /** Package-style name, e.g. `@camelia/plugin-notify` or `my-plugin`. */
  name: string;
  kind: PluginKind;
  /**
   * Path to the payload, relative to the plugin directory.
   *
   * `theme` and `agent-preset` point at a `.json` data file (loaded as data, never
   * executed); `provider` and `tool` point at a `.js`/`.mjs` module.
   */
  entry: string;
  /** Declared capabilities. Defaults to none when omitted. */
  permissions: PluginPermission[];
  version?: string;
  description?: string;
}

export interface PluginManifestIssue {
  /** Dotted path of the offending field, e.g. `permissions[1]`. */
  path: string;
  message: string;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; issues: PluginManifestIssue[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate an unknown value into a {@link PluginManifest}.
 *
 * Collects *all* issues rather than throwing on the first, so `camelia plugin list`
 * can show the user everything wrong with a hand-written manifest in one pass.
 */
export function parsePluginManifest(raw: unknown): ParseResult<PluginManifest> {
  const issues: PluginManifestIssue[] = [];
  if (!isRecord(raw)) {
    return { ok: false, issues: [{ path: '', message: 'manifest must be a JSON object' }] };
  }

  const name = raw.name;
  if (typeof name !== 'string' || !name.trim()) {
    issues.push({ path: 'name', message: 'name must be a non-empty string' });
  }

  const kind = raw.kind;
  if (typeof kind !== 'string' || !(PLUGIN_KINDS as readonly string[]).includes(kind)) {
    issues.push({ path: 'kind', message: `kind must be one of ${PLUGIN_KINDS.join(' | ')}` });
  }

  const entry = raw.entry;
  if (typeof entry !== 'string' || !entry.trim()) {
    issues.push({ path: 'entry', message: 'entry must be a non-empty string' });
  } else if (isUnsafeRelativePath(entry)) {
    issues.push({ path: 'entry', message: 'entry must be a relative path inside the plugin directory' });
  }

  const permissions: PluginPermission[] = [];
  if (raw.permissions !== undefined) {
    if (!Array.isArray(raw.permissions)) {
      issues.push({ path: 'permissions', message: 'permissions must be an array' });
    } else {
      raw.permissions.forEach((permission, index) => {
        if (typeof permission !== 'string' || !(PLUGIN_PERMISSIONS as readonly string[]).includes(permission)) {
          issues.push({
            path: `permissions[${index}]`,
            message: `unknown permission; allowed: ${PLUGIN_PERMISSIONS.join(' | ')}`,
          });
        } else {
          permissions.push(permission as PluginPermission);
        }
      });
    }
  }

  for (const field of ['version', 'description'] as const) {
    const value = raw[field];
    if (value !== undefined && typeof value !== 'string') {
      issues.push({ path: field, message: `${field} must be a string when present` });
    }
  }

  if (issues.length > 0) return { ok: false, issues };

  return {
    ok: true,
    value: {
      name: (name as string).trim(),
      kind: kind as PluginKind,
      entry: (entry as string).trim(),
      permissions,
      version: typeof raw.version === 'string' ? raw.version : undefined,
      description: typeof raw.description === 'string' ? raw.description : undefined,
    },
  };
}

/**
 * Reject `entry` values that could escape the plugin directory.
 *
 * A manifest is data the user may not have written; `entry: '../../../../etc/passwd'`
 * must never resolve outside the plugin root, or "install a plugin" becomes "read any
 * file on disk".
 */
export function isUnsafeRelativePath(entry: string): boolean {
  if (entry.startsWith('/') || entry.startsWith('\\')) return true;
  if (/^[a-zA-Z]:/.test(entry)) return true;
  return entry.split(/[\\/]/).some((segment) => segment === '..');
}

/**
 * The capabilities a tool of a given risk level needs in order to run.
 *
 * Used by the loader to refuse a tool plugin whose declared permissions cannot
 * cover what its tools claim to do — the gap between "declares fs:read" and
 * "deletes files" is exactly where an undeclared capability would hide.
 */
export function permissionsForRisk(risk: RiskLevel): PluginPermission[] {
  switch (risk) {
    case 'read-only':
      return ['fs:read'];
    case 'write':
    case 'destructive':
      return ['fs:read', 'fs:write'];
    case 'network':
      return ['net'];
    case 'privileged':
      return ['shell:exec'];
  }
}

/** Permissions a tool needs but the plugin did not declare. Empty means it may run. */
export function missingPermissions(risk: RiskLevel, declared: readonly PluginPermission[]): PluginPermission[] {
  return permissionsForRisk(risk).filter((needed) => !declared.includes(needed));
}
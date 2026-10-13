/**
 * Plugin loader — discovery, validation, permission enforcement and loading.
 *
 * One manifest shape (`camelia.plugin.json`) drives all four extension points
 * (whitepaper §8). The loader is deliberately the *only* place a plugin becomes
 * live, so the whole trust boundary is one file you can audit.
 *
 * Two rules the loader will not bend:
 *
 * 1. **Fail closed.** A manifest that does not parse, an entry that escapes the
 *    plugin directory, a tool whose declared risk exceeds the declared
 *    permissions, a module that does not export what its kind requires — each is a
 *    rejection with a reason, never a silent skip.
 * 2. **Declared permissions are enforced, not documented.** A plugin tool is
 *    handed a *restricted* `ToolContext`: without `fs:write` the write methods
 *    throw, without `shell:exec` the shell port throws. Checking a declaration and
 *    then handing over the real ports would make the declaration a lie.
 *
 * Process isolation (whitepaper §8.1) is not implemented yet: plugins load
 * in-process, which is the same trust level as `~/.camelia/config.json`. The
 * loader is the single seam where a worker boundary will be inserted.
 * @module
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { DEFAULT_SANDBOX_TIMEOUT_MS, loadToolsInWorker } from './sandbox.js';
import {
  isUnsafeRelativePath,
  missingPermissions,
  parseAgentPreset,
  parsePluginManifest,
  parseThemePlugin,
  type AgentPreset,
  type FsPort,
  type LLMPort,
  type LoggerPort,
  type PluginManifest,
  type PluginManifestIssue,
  type PluginPermission,
  type ShellPort,
  type ThemePlugin,
} from '@camelia/core';
import type { Tool, ToolContext } from '@camelia/harness';

/** The manifest filename every plugin directory must contain. */
export const PLUGIN_MANIFEST_FILE = 'camelia.plugin.json';

export interface DiscoveredPlugin {
  /** Absolute plugin directory. */
  dir: string;
  manifest: PluginManifest;
}

export interface RejectedPlugin {
  dir: string;
  /** Plugin name when the manifest named one before failing. */
  name?: string;
  reason: string;
  issues?: PluginManifestIssue[];
}

export interface LoadedToolPlugin {
  manifest: PluginManifest;
  dir: string;
  tools: Tool<any, any>[];
}

export interface LoadedProviderPlugin {
  manifest: PluginManifest;
  dir: string;
  /** Builds the provider port. Called once per registry construction. */
  createPort: () => LLMPort;
}

export interface LoadedThemePlugin {
  manifest: PluginManifest;
  dir: string;
  theme: ThemePlugin;
}

export interface LoadedPresetPlugin {
  manifest: PluginManifest;
  dir: string;
  preset: AgentPreset;
}

export interface PluginLoadResult {
  tools: LoadedToolPlugin[];
  providers: LoadedProviderPlugin[];
  themes: LoadedThemePlugin[];
  presets: LoadedPresetPlugin[];
  rejected: RejectedPlugin[];
}

export class PluginLoader {
  constructor(
    private readonly logger?: LoggerPort,
    /** Worker deadline for loading one tool plugin. */
    private readonly sandboxTimeoutMs: number = DEFAULT_SANDBOX_TIMEOUT_MS,
  ) {}

  /**
   * Find every plugin directory under `root` and validate its manifest.
   *
   * A directory without a manifest is not a plugin and is ignored; a directory
   * *with* a bad manifest is a rejection the user must see.
   */
  discover(root: string): { found: DiscoveredPlugin[]; rejected: RejectedPlugin[] } {
    const found: DiscoveredPlugin[] = [];
    const rejected: RejectedPlugin[] = [];
    if (!fs.existsSync(root)) return { found, rejected };

    const entries = fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const dir = path.join(root, entry.name);
      const manifestPath = path.join(dir, PLUGIN_MANIFEST_FILE);
      if (!fs.existsSync(manifestPath)) continue;

      const raw = readJson(manifestPath);
      if (raw === undefined) {
        rejected.push({ dir, reason: `${PLUGIN_MANIFEST_FILE} is not valid JSON` });
        continue;
      }
      const parsed = parsePluginManifest(raw);
      if (!parsed.ok) {
        rejected.push({ dir, reason: 'invalid plugin manifest', issues: parsed.issues });
        continue;
      }
      found.push({ dir, manifest: parsed.value });
    }
    return { found, rejected };
  }

  /** Discover and load every plugin under `root`. Never throws for plugin faults. */
  async load(root: string): Promise<PluginLoadResult> {
    const result: PluginLoadResult = { tools: [], providers: [], themes: [], presets: [], rejected: [] };
    const { found, rejected } = this.discover(root);
    result.rejected.push(...rejected);

    for (const plugin of found) {
      try {
        await this.loadOne(plugin, result);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.logger?.warn('plugin failed to load', { dir: plugin.dir, reason });
        result.rejected.push({ dir: plugin.dir, name: plugin.manifest.name, reason });
      }
    }
    return result;
  }

  private async loadOne(plugin: DiscoveredPlugin, result: PluginLoadResult): Promise<void> {
    const { dir, manifest } = plugin;
    const entryPath = path.resolve(dir, manifest.entry);

    // `parsePluginManifest` already rejects traversal, but resolving again here keeps
    // the guarantee local to the code that actually touches the filesystem.
    if (isUnsafeRelativePath(manifest.entry) || !isInside(dir, entryPath)) {
      result.rejected.push({ dir, name: manifest.name, reason: `entry "${manifest.entry}" escapes the plugin directory` });
      return;
    }
    if (!fs.existsSync(entryPath)) {
      result.rejected.push({ dir, name: manifest.name, reason: `entry file not found: ${manifest.entry}` });
      return;
    }

    switch (manifest.kind) {
      case 'theme':
        return this.loadTheme(plugin, entryPath, result);
      case 'agent-preset':
        return this.loadPreset(plugin, entryPath, result);
      case 'tool':
        return this.loadToolPlugin(plugin, entryPath, result);
      case 'provider':
        return this.loadProviderPlugin(plugin, entryPath, result);
    }
  }

  private loadTheme(plugin: DiscoveredPlugin, entryPath: string, result: PluginLoadResult): void {
    const raw = readJson(entryPath);
    if (raw === undefined) {
      result.rejected.push({ dir: plugin.dir, name: plugin.manifest.name, reason: 'theme entry is not valid JSON' });
      return;
    }
    const parsed = parseThemePlugin(raw);
    if (!parsed.ok) {
      result.rejected.push({ dir: plugin.dir, name: plugin.manifest.name, reason: 'invalid theme', issues: parsed.issues });
      return;
    }
    result.themes.push({ manifest: plugin.manifest, dir: plugin.dir, theme: parsed.value });
  }

  private loadPreset(plugin: DiscoveredPlugin, entryPath: string, result: PluginLoadResult): void {
    const raw = readJson(entryPath);
    if (raw === undefined) {
      result.rejected.push({ dir: plugin.dir, name: plugin.manifest.name, reason: 'preset entry is not valid JSON' });
      return;
    }
    const parsed = parseAgentPreset(raw);
    if (!parsed.ok) {
      result.rejected.push({ dir: plugin.dir, name: plugin.manifest.name, reason: 'invalid preset', issues: parsed.issues });
      return;
    }
    result.presets.push({ manifest: plugin.manifest, dir: plugin.dir, preset: parsed.value });
  }

  private async loadToolPlugin(plugin: DiscoveredPlugin, entryPath: string, result: PluginLoadResult): Promise<void> {
    // Tool plugins are loaded in a worker thread (whitepaper §8.1). A plugin runs
    // third-party code, and without the worker a `process.exit()` or a runaway
    // loop inside one takes the whole engine down with it.
    //
    // The worker reports *descriptors*; the executable `run` functions still come
    // from the in-process import below. That split is deliberate and honest
    // about what a worker buys: containment at load time and removal of the
    // module's top-level side effects from the engine's process. It does not
    // sandbox the tool's later invocations — those are still governed by the
    // permission-restricted `ToolContext` below, which is the real enforcement.
    const probe = await loadToolsInWorker({
      entry: moduleHref(entryPath),
      permissions: plugin.manifest.permissions,
      timeoutMs: this.sandboxTimeoutMs,
    });
    if (!probe.ok) {
      result.rejected.push({
        dir: plugin.dir,
        name: plugin.manifest.name,
        reason: `sandbox rejected the plugin: ${probe.error}`,
      });
      return;
    }

    const module = await importModule(entryPath);
    const tools = extractTools(module);
    if (!tools || tools.length === 0) {
      result.rejected.push({
        dir: plugin.dir,
        name: plugin.manifest.name,
        reason: 'tool plugin must export `tools: Tool[]` (or a default export with `tools`)',
      });
      return;
    }

    const shaped: Tool<any, any>[] = [];
    const issues: PluginManifestIssue[] = [];
    tools.forEach((candidate, index) => {
      const problem = validateToolShape(candidate);
      if (problem) {
        issues.push({ path: `tools[${index}]`, message: problem });
        return;
      }
      const tool = candidate as Tool<any, any>;
      // Declared risk must be covered by declared permissions, or the plugin is
      // claiming an effect it did not ask for.
      const missing = missingPermissions(tool.risk, plugin.manifest.permissions);
      if (missing.length > 0) {
        issues.push({
          path: `tools[${index}]`,
          message: `tool "${tool.name}" is ${tool.risk} but the manifest does not declare: ${missing.join(', ')}`,
        });
        return;
      }
      shaped.push(wrapPluginTool(tool, plugin.manifest.permissions));
    });

    if (issues.length > 0) {
      result.rejected.push({ dir: plugin.dir, name: plugin.manifest.name, reason: 'tool plugin permission/shape check failed', issues });
      return;
    }
    result.tools.push({ manifest: plugin.manifest, dir: plugin.dir, tools: shaped });
  }

  private async loadProviderPlugin(plugin: DiscoveredPlugin, entryPath: string, result: PluginLoadResult): Promise<void> {
    const module = await importModule(entryPath);
    const factory = pickFactory(module);
    if (typeof factory !== 'function') {
      result.rejected.push({
        dir: plugin.dir,
        name: plugin.manifest.name,
        reason: 'provider plugin must export a `createProvider()` function (or a default function)',
      });
      return;
    }
    result.providers.push({ manifest: plugin.manifest, dir: plugin.dir, createPort: () => factory() as LLMPort });
  }
}

// ---------------------------------------------------------------------------
// Module loading
// ---------------------------------------------------------------------------

/**
 * File URL for a plugin entry.
 *
 * `pathToFileURL` percent-encodes `~` as `%7E`. vite-node then uses that
 * sequence as part of the filename (`RUNNER%7E1`) and reports the file
 * missing. `~` is unreserved in a URL, so put it back after encoding.
 * A native realpath first expands 8.3 short names when the OS will.
 */
function moduleHref(entryPath: string): string {
  const absolute = path.resolve(entryPath);
  let canonical = absolute;
  try {
    canonical = fs.realpathSync.native(absolute);
  } catch {
    canonical = absolute;
  }
  return pathToFileURL(canonical).href.replace(/%7E/gi, '~');
}

/** Dynamic-import a module by absolute path, as an ESM URL. */
async function importModule(entryPath: string): Promise<Record<string, unknown>> {
  return (await import(moduleHref(entryPath))) as Record<string, unknown>;
}

/** Accept `tools`, `default.tools`, or a default export that is itself an array. */
function extractTools(module: Record<string, unknown>): unknown[] | undefined {
  if (Array.isArray(module.tools)) return module.tools;
  const fallback = module.default;
  if (Array.isArray(fallback)) return fallback;
  if (fallback && typeof fallback === 'object' && Array.isArray((fallback as { tools?: unknown }).tools)) {
    return (fallback as { tools: unknown[] }).tools;
  }
  return undefined;
}

function pickFactory(module: Record<string, unknown>): unknown {
  if (typeof module.createProvider === 'function') return module.createProvider;
  const fallback = module.default;
  if (typeof fallback === 'function') return fallback;
  if (fallback && typeof fallback === 'object' && typeof (fallback as { createProvider?: unknown }).createProvider === 'function') {
    return (fallback as { createProvider: unknown }).createProvider;
  }
  return undefined;
}

/** Returns a human-readable problem, or `undefined` when the tool is well-shaped. */
function validateToolShape(tool: unknown): string | undefined {
  if (!tool || typeof tool !== 'object') return 'tool must be an object';
  const candidate = tool as Partial<Tool<any, any>>;
  if (typeof candidate.name !== 'string' || !candidate.name) return 'tool.name must be a non-empty string';
  if (typeof candidate.description !== 'string' || !candidate.description) return 'tool.description must be a non-empty string';
  if (!candidate.schema || typeof candidate.schema !== 'object') return 'tool.schema must be a JSON schema object';
  if (typeof candidate.risk !== 'string') return 'tool.risk is required';
  if (typeof candidate.reversible !== 'boolean') return 'tool.reversible is required';
  if (typeof candidate.run !== 'function') return 'tool.run must be a function';
  return undefined;
}

// ---------------------------------------------------------------------------
// Capability restriction
// ---------------------------------------------------------------------------

/**
 * Wrap a plugin tool so it (a) defaults to `ask` and (b) only ever sees the
 * ports its manifest declared.
 */
export function wrapPluginTool(tool: Tool<any, any>, permissions: readonly PluginPermission[]): Tool<any, any> {
  return {
    ...tool,
    // A tool that arrives after install is never silently auto-approved just
    // because it declared a low risk (whitepaper §8.2).
    approval: tool.approval ?? 'ask',
    run: (input, ctx) => tool.run(input, restrictToolContext(ctx, permissions, tool.name)),
  };
}

/** Build a `ToolContext` whose ports refuse operations the plugin did not declare. */
export function restrictToolContext(
  ctx: ToolContext,
  permissions: readonly PluginPermission[],
  toolName: string,
): ToolContext {
  const canRead = permissions.includes('fs:read');
  const canWrite = permissions.includes('fs:write');
  const canExec = permissions.includes('shell:exec');

  const fs: FsPort = {
    readFile: canRead ? (p) => ctx.fs.readFile(p) : () => deny('fs.readFile', 'fs:read', toolName),
    exists: canRead ? (p) => ctx.fs.exists(p) : () => deny('fs.exists', 'fs:read', toolName),
    list: canRead ? (p, o) => ctx.fs.list(p, o) : () => deny('fs.list', 'fs:read', toolName),
    stat: canRead ? (p) => ctx.fs.stat(p) : () => deny('fs.stat', 'fs:read', toolName),
    hash: canRead ? (p) => ctx.fs.hash(p) : () => deny('fs.hash', 'fs:read', toolName),
    writeFile: canWrite ? (p, c) => ctx.fs.writeFile(p, c) : () => deny('fs.writeFile', 'fs:write', toolName),
    mkdir: canWrite ? (p) => ctx.fs.mkdir(p) : () => deny('fs.mkdir', 'fs:write', toolName),
    remove: canWrite ? (p) => ctx.fs.remove(p) : () => deny('fs.remove', 'fs:write', toolName),
  };

  const shell: ShellPort = {
    exec: canExec ? (c, o) => ctx.shell.exec(c, o) : () => deny('shell.exec', 'shell:exec', toolName),
  };

  return { ...ctx, fs, shell };
}

function deny(operation: string, permission: PluginPermission, toolName: string): never {
  throw new Error(`plugin tool "${toolName}" called ${operation} but did not declare the "${permission}" permission`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
}

/** True when `child` resolves inside `parent`. */
function isInside(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), child);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}
/**
 * Preset registry — merges built-in, plugin-supplied and user-authored presets.
 *
 * Precedence is deliberate and one-directional: built-ins are the floor, plugins
 * add on top, and the user's own files win. A user who writes
 * `~/.camelia/presets/coder.json` means to change `coder`, and silently ignoring
 * that would be worse than any conflict it resolves.
 *
 * Loading never throws: a malformed preset is reported as an issue and skipped, so
 * one bad file cannot make `camelia` unrunnable.
 * @module
 */

import fs from 'node:fs';
import path from 'node:path';

import { parseAgentPreset, type AgentPreset, type PluginManifestIssue } from '@camelia/core';

import { builtinPresets } from './builtins.js';

export interface PresetSourceIssue {
  /** File the preset came from, or `(plugin)` for plugin-supplied presets. */
  file: string;
  issues: PluginManifestIssue[];
}

export class PresetRegistry {
  private readonly byId = new Map<string, AgentPreset>();
  /** Insertion order, for stable listing. */
  private readonly order: string[] = [];

  constructor(presets: AgentPreset[] = []) {
    for (const preset of presets) this.add(preset);
  }

  private add(preset: AgentPreset): void {
    if (!this.byId.has(preset.id)) this.order.push(preset.id);
    this.byId.set(preset.id, preset);
  }

  /**
   * Build a registry from built-ins, plugin-supplied presets and a user directory.
   *
   * Later sources override earlier ones by id (built-ins < plugin < user file).
   */
  static fromSources(options: {
    builtins?: AgentPreset[];
    fromPlugins?: AgentPreset[];
    userDir?: string;
  } = {}): { registry: PresetRegistry; issues: PresetSourceIssue[] } {
    const registry = new PresetRegistry();
    for (const preset of options.builtins ?? builtinPresets) registry.add(preset);
    for (const preset of options.fromPlugins ?? []) registry.add(preset);

    const issues: PresetSourceIssue[] = [];
    if (options.userDir && fs.existsSync(options.userDir)) {
      const files = fs
        .readdirSync(options.userDir)
        .filter((name) => name.toLowerCase().endsWith('.json'))
        .sort();
      for (const name of files) {
        const file = path.join(options.userDir, name);
        const parsed = readJson(file);
        if (parsed === undefined) {
          issues.push({ file, issues: [{ path: '', message: 'file is not valid JSON' }] });
          continue;
        }
        const result = parseAgentPreset(parsed);
        if (!result.ok) {
          issues.push({ file, issues: result.issues });
          continue;
        }
        registry.add(result.value);
      }
    }
    return { registry, issues };
  }

  get(id: string): AgentPreset | undefined {
    return this.byId.get(id);
  }

  resolve(id: string | undefined): AgentPreset | undefined {
    if (!id) return undefined;
    return this.byId.get(id);
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  ids(): string[] {
    return [...this.order];
  }

  list(): AgentPreset[] {
    return this.order.map((id) => this.byId.get(id)!);
  }

  get size(): number {
    return this.order.length;
  }
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
}
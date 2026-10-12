/**
 * Preset registry and runtime preset resolution (Iteration 26 — Stage 1).
 *
 * `PresetRegistry.fromSources` (user `*.json` loading, issue reporting) and
 * `CameliaRuntime`'s preset resolution were mostly driven by cli/e2e paths; the
 * agent package itself asserted almost nothing. These tests assert the registry
 * merge/override/issue behaviour and the runtime's "unknown preset is an error"
 * contract directly.
 * @module
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { AgentPreset, ChatChunk, ChatRequest, LLMPort } from '@camelia/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { builtinPresets } from '../src/presets/builtins.js';
import { PresetRegistry } from '../src/presets/PresetRegistry.js';
import { CameliaRuntime } from '../src/runtime/CameliaRuntime.js';
import type { ProviderHandle } from '../src/ProviderRegistry.js';
import { MockProvider } from '../src/providers/MockProvider.js';
import { scriptedTaskScript } from '../src/providers/ScriptedAgentProvider.js';

const runtimes: CameliaRuntime[] = [];

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((r) => r.close().catch(() => undefined)));
  vi.unstubAllEnvs();
});

function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function scriptedHandle(): ProviderHandle {
  const inner = new MockProvider({ id: 'mock', models: ['scripted'], script: scriptedTaskScript({ create: { 'a.ts': 'x' } }) });
  const port: LLMPort = {
    id: 'mock',
    capabilities: () => inner.capabilities(),
    listModels: () => inner.listModels(),
    async *chat(request: ChatRequest, signal?: AbortSignal): AsyncIterable<ChatChunk> {
      yield* inner.chat(request, signal);
    },
  };
  return { id: 'mock', label: 'Scripted mock', model: 'scripted', models: ['scripted'], port };
}

// ---------------------------------------------------------------------------
// PresetRegistry — direct assertions
// ---------------------------------------------------------------------------

describe('PresetRegistry', () => {
  it('starts from the built-ins in stable order', () => {
    const { registry, issues } = PresetRegistry.fromSources();
    expect(issues).toEqual([]);
    expect(registry.ids()).toEqual(builtinPresets.map((p) => p.id));
    expect(registry.size).toBe(builtinPresets.length);
    expect(registry.has('coder')).toBe(true);
    expect(registry.get('coder')?.label).toBe('Coder');
    expect(registry.resolve(undefined)).toBeUndefined();
  });

  it('lets a user file override a built-in by id and plugin presets add on top', () => {
    const dir = tempDir('camelia-presets-');
    fs.writeFileSync(
      path.join(dir, 'coder.json'),
      JSON.stringify({
        id: 'coder',
        label: 'User Coder',
        description: 'user override',
        systemPrompt: 'Be careful.',
        allowedTools: ['*'],
        plannerMode: 'full',
        modelPreference: {},
      }),
      'utf8',
    );
    const pluginPreset: AgentPreset = {
      id: 'plugin-persona',
      label: 'Plugin',
      description: 'from a plugin',
      systemPrompt: 'x',
      allowedTools: ['fs.read'],
      plannerMode: 'fast',
      modelPreference: {},
    };

    const { registry, issues } = PresetRegistry.fromSources({ fromPlugins: [pluginPreset], userDir: dir });
    expect(issues).toEqual([]);
    expect(registry.get('coder')?.label).toBe('User Coder'); // user wins over built-in
    expect(registry.get('plugin-persona')?.allowedTools).toEqual(['fs.read']);
    expect(registry.ids()).toContain('coder');
    expect(registry.ids()).toContain('plugin-persona');
    expect(registry.list().map((p) => p.id)).toEqual(registry.ids());
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reports a malformed file as an issue and keeps the registry usable', () => {
    const dir = tempDir('camelia-presets-bad-');
    fs.writeFileSync(path.join(dir, 'bad.json'), '{not json', 'utf8');
    fs.writeFileSync(
      path.join(dir, 'ok.json'),
      JSON.stringify({
        id: 'ok', label: 'Ok', description: 'd', systemPrompt: 'p',
        allowedTools: ['fs.read'], plannerMode: 'fast', modelPreference: {},
      }),
      'utf8',
    );

    const { registry, issues } = PresetRegistry.fromSources({ userDir: dir });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.file).toContain('bad.json');
    expect(issues[0]?.issues[0]?.message).toContain('not valid JSON');
    expect(registry.get('ok')).toBeTruthy(); // one bad file does not disable the good one
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reports a preset with the wrong shape as an issue (missing allowedTools)', () => {
    const dir = tempDir('camelia-presets-shape-');
    fs.writeFileSync(
      path.join(dir, 'shape.json'),
      JSON.stringify({ id: 'shape', label: 'Shape', description: 'd', systemPrompt: 'p' }),
      'utf8',
    );

    const { registry, issues } = PresetRegistry.fromSources({ userDir: dir });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.issues[0]?.path).toBe('allowedTools');
    expect(registry.get('shape')).toBeUndefined();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// CameliaRuntime — preset resolution is an error contract, not a silent fallback
// ---------------------------------------------------------------------------

describe('CameliaRuntime preset resolution', () => {
  it('throws on an unknown preset id instead of silently running unconstrained', async () => {
    const workspace = tempDir('camelia-preset-ws-');
    vi.stubEnv('CAMELIA_HOME', tempDir('camelia-preset-home-'));
    await expect(
      CameliaRuntime.create({
        workspace,
        providerHandles: [scriptedHandle()],
        preset: 'no-such-preset',
        databaseFile: ':memory:',
        autoApprove: true,
        logLevel: 'error',
        logTo: () => undefined,
      }),
    ).rejects.toThrow(/unknown agent preset "no-such-preset"/);
  });

  it('resolves a preset from the user preset directory and applies its model preference', async () => {
    const presetDir = tempDir('camelia-preset-user-');
    fs.writeFileSync(
      path.join(presetDir, 'fast.json'),
      JSON.stringify({
        id: 'fast', label: 'Fast', description: 'd', systemPrompt: 'Be fast.',
        allowedTools: ['fs.read', 'fs.list'], plannerMode: 'fast',
        modelPreference: { decision: 'small-model', grunt: 'tiny-model' },
      }),
      'utf8',
    );

    const workspace = tempDir('camelia-preset-ws2-');
    vi.stubEnv('CAMELIA_HOME', tempDir('camelia-preset-home2-'));
    const runtime = await CameliaRuntime.create({
      workspace,
      providerHandles: [scriptedHandle()],
      preset: 'fast',
      presetDir,
      databaseFile: ':memory:',
      autoApprove: true,
      planApproval: 'auto',
      logLevel: 'error',
      logTo: () => undefined,
    });
    runtimes.push(runtime);

    expect(runtime.preset?.id).toBe('fast');
    expect(runtime.preset?.allowedTools).toEqual(['fs.read', 'fs.list']);
    expect(runtime.modelInfo.model).toBe('small-model');
    expect(runtime.modelInfo.gruntModel).toBe('tiny-model');
    fs.rmSync(presetDir, { recursive: true, force: true });
  });
});

/**
 * Shared bootstrap for the metric suites that drive the *real* composition root.
 *
 * M2 (medium) and M3 (complex) both run a fixed set of tasks through
 * `CameliaRuntime` with real files, real commands and real SQLite, differing only
 * in the task shape. Keeping the bootstrap here means the two suites assert the
 * same thing about the engine — a task finishes `done` with zero unverified steps —
 * rather than each re-implementing runtime setup and drifting apart.
 * @module
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { vi } from 'vitest';

import { CameliaRuntime } from '../../src/runtime/CameliaRuntime.js';
import type { ProviderHandle } from '../../src/ProviderRegistry.js';
import { MockProvider } from '../../src/providers/MockProvider.js';
import { scriptedTaskScript, type ScriptedTaskSpec } from '../../src/providers/ScriptedAgentProvider.js';

const runtimes: CameliaRuntime[] = [];

/** Close every runtime opened since the last call — wire this into `afterEach`. */
export async function closeRuntimes(): Promise<void> {
  await Promise.all(runtimes.splice(0).map((r) => r.close().catch(() => undefined)));
  vi.unstubAllEnvs();
}

export function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Wrap a scripted spec in the provider handle the runtime expects. */
export function scriptedHandle(spec: ScriptedTaskSpec): ProviderHandle {
  const port = new MockProvider({ id: 'mock', models: ['scripted'], script: scriptedTaskScript(spec) });
  return { id: 'mock', label: 'Scripted mock', model: 'scripted', models: ['scripted'], port };
}

export interface ScriptedRunResult {
  status: string;
  stepsCompleted: number;
  stepsTotal: number;
  unverified: number;
  workspace: string;
}

/**
 * Seed a fresh workspace, run one scripted task to completion, and report the
 * outcome. The provider is the deterministic scripted one — the same code path as
 * `camelia run --mock`; only the task shape varies between cases.
 */
export async function runScriptedTask(
  spec: ScriptedTaskSpec,
  seed: Record<string, string> = {},
): Promise<ScriptedRunResult> {
  const workspace = tempDir('camelia-task-');
  const home = tempDir('camelia-task-home-');
  vi.stubEnv('CAMELIA_HOME', home);
  for (const [rel, content] of Object.entries(seed)) {
    const abs = path.join(workspace, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }

  const runtime = await CameliaRuntime.create({
    workspace,
    providerHandles: [scriptedHandle(spec)],
    databaseFile: ':memory:',
    autoApprove: true,
    logLevel: 'error',
    logTo: () => undefined,
  });
  runtimes.push(runtime);

  const created = Object.keys(spec.create ?? {});
  const edited = Object.keys(spec.edit ?? {});
  const intent = created.length > 0 ? `create ${created.join(' ')}` : edited.length > 0 ? `update ${edited.join(' ')}` : 'complete the task';
  const result = await runtime.run(intent);
  return {
    status: result.outcome.status,
    stepsCompleted: result.outcome.stepsCompleted,
    stepsTotal: result.outcome.stepsTotal,
    unverified: result.outcome.unverifiedSteps,
    workspace,
  };
}
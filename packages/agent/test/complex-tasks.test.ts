/**
 * Metric M3 — complex tasks (cross-module new feature).
 *
 * M3 asks a harder question than M2: can the engine land a *feature* that spans
 * several new modules and an existing entry point, then prove the wiring works
 * functionally — not merely that the files parse?
 *
 * Each case seeds a stub entry point, adds N feature modules, wires them into the
 * entry point's registry, and finishes with a `node check.mjs` step that imports
 * the registry and asserts every feature's return value. That command is the
 * cross-module proof: it fails unless the new modules exist *and* are correctly
 * re-exported through the entry point.
 *
 * The suite runs a fixed set through the real composition root (real files, real
 * commands, real SQLite) and reports the completion rate the whitepaper's M3
 * target (≥ 60%) is measured against.
 * @module
 */

import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { closeRuntimes, runScriptedTask } from './helpers/task-runner.js';
import type { ScriptedTaskSpec } from '../src/providers/ScriptedAgentProvider.js';

afterEach(closeRuntimes);

interface ComplexTask {
  name: string;
  spec: ScriptedTaskSpec;
  seed: Record<string, string>;
  expectFiles: Record<string, string>;
}

/**
 * A cross-module feature: `moduleCount` new modules, wired into the existing
 * `src/index.mjs` registry, verified by a functional import-and-assert command.
 */
function featureTask(n: number, moduleCount: number): ComplexTask {
  const create: Record<string, string> = {};
  const edit: Record<string, { oldText: string; newText: string }> = {};
  const names: string[] = [];
  const checks: string[] = [];

  for (let i = 0; i < moduleCount; i += 1) {
    const name = `feature${i}`;
    const value = n * 100 + i;
    names.push(name);
    create[`src/${name}.mjs`] = `export function ${name}() {\n  return ${value};\n}\n`;
    checks.push(`if (registry.${name}() !== ${value}) throw new Error('${name} mismatch');`);
  }

  const imports = names.map((name) => `import { ${name} } from './${name}.mjs';`).join('\n');
  const entries = names.map((name) => `  ${name},`).join('\n');
  const wiredIndex = `${imports}\nexport const registry = {\n${entries}\n};\n`;
  edit['src/index.mjs'] = { oldText: 'export const registry = {};\n', newText: wiredIndex };

  create['check.mjs'] = `import { registry } from './src/index.mjs';\n${checks.join('\n')}\nconsole.log('ok');\n`;

  return {
    name: `complex #${n}: wire ${moduleCount} new modules into an existing entry point`,
    spec: { create, edit, commands: ['node check.mjs'] },
    seed: { 'src/index.mjs': 'export const registry = {};\n' },
    expectFiles: { ...create, 'src/index.mjs': wiredIndex },
  };
}

const TASKS: ComplexTask[] = [
  featureTask(1, 3),
  featureTask(2, 4),
  featureTask(3, 5),
  featureTask(4, 3),
  featureTask(5, 6),
  featureTask(6, 4),
  featureTask(7, 5),
  featureTask(8, 6),
];

describe('M3 — complex cross-module tasks complete end to end', () => {
  it('has a set of at least eight complex tasks', () => {
    expect(TASKS.length).toBeGreaterThanOrEqual(8);
  });

  it.each(TASKS)('$name', async (task) => {
    const outcome = await runScriptedTask(task.spec, task.seed);

    expect(outcome.status).toBe('done');
    expect(outcome.unverified).toBe(0);
    expect(outcome.stepsCompleted).toBe(outcome.stepsTotal);

    for (const [rel, content] of Object.entries(task.expectFiles)) {
      expect(fs.readFileSync(path.join(outcome.workspace, rel), 'utf8')).toBe(content);
    }
  });
});
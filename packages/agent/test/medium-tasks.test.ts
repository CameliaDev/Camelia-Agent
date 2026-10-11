/**
 * Metric M2 — medium tasks (multi-file change with dependency order).
 *
 * The whitepaper's M2 is a *rate*: of a set of medium tasks, how many complete
 * end to end. A single example cannot support that claim, so this suite runs a
 * fixed set of ≥15 medium tasks through the real composition root — real files,
 * real `node --check` commands, real SQLite — and asserts every one of them
 * finishes `done` with zero unverified steps.
 *
 * The provider is the deterministic scripted one, exactly as `camelia run --mock`
 * uses; what varies is the *task shape*: how many files, whether they are created
 * or refactored in place, and how many verification commands run afterwards.
 * @module
 */

import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { closeRuntimes, runScriptedTask } from './helpers/task-runner.js';
import type { ScriptedTaskSpec } from '../src/providers/ScriptedAgentProvider.js';

afterEach(closeRuntimes);

interface MediumTask {
  name: string;
  spec: ScriptedTaskSpec;
  seed: Record<string, string>;
  expectFiles: Record<string, string>;
}

/** A multi-file *create* task: n valid ES modules, each syntax-checked. */
function createTask(n: number, fileCount: number): MediumTask {
  const files: Record<string, string> = {};
  for (let i = 0; i < fileCount; i += 1) {
    files[`mod-${n}-${i}.mjs`] = `export const value${i} = ${n * 10 + i};\nexport const label${i} = 'module ${n}-${i}';\n`;
  }
  return {
    name: `medium #${n}: create ${fileCount} modules and syntax-check each`,
    spec: { create: files, commands: Object.keys(files).map((f) => `node --check ${f}`) },
    seed: {},
    expectFiles: files,
  };
}

/** A multi-file *refactor* task: rename a symbol across seeded modules. */
function refactorTask(n: number, fileCount: number): MediumTask {
  const seed: Record<string, string> = {};
  const expectFiles: Record<string, string> = {};
  const edit: Record<string, { oldText: string; newText: string }> = {};
  for (let i = 0; i < fileCount; i += 1) {
    const file = `svc-${n}-${i}.mjs`;
    seed[file] = `export const oldName${i} = ${n + i};\n`;
    expectFiles[file] = `export const newName${i} = ${n + i};\n`;
    edit[file] = { oldText: `oldName${i}`, newText: `newName${i}` };
  }
  return {
    name: `medium #${n}: refactor a symbol across ${fileCount} modules`,
    spec: { edit, commands: Object.keys(seed).map((f) => `node --check ${f}`) },
    seed,
    expectFiles,
  };
}

const TASKS: MediumTask[] = [
  createTask(1, 2),
  createTask(2, 3),
  createTask(3, 4),
  createTask(4, 2),
  createTask(5, 3),
  createTask(6, 4),
  createTask(7, 2),
  createTask(8, 3),
  refactorTask(9, 2),
  refactorTask(10, 3),
  refactorTask(11, 4),
  refactorTask(12, 2),
  refactorTask(13, 3),
  refactorTask(14, 4),
  refactorTask(15, 3),
];

describe('M2 — medium tasks complete end to end', () => {
  it('has a set of at least fifteen medium tasks', () => {
    expect(TASKS.length).toBeGreaterThanOrEqual(15);
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
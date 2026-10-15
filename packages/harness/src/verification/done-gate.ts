/**
 * Done gate — run project verification before a turn/task may claim success.
 *
 * Integrates with workspace journals (dirty detection) and optional overrides
 * from the runtime (`testCommand`). Phase 4 hard gates classify failures as
 * `test` / `type`; this module is the mechanical runner those gates depend on.
 * @module
 */

import fs from 'node:fs';
import path from 'node:path';

import type { LoggerPort, ShellPort } from '@camelia/core';

import type { WorkspaceJournal } from '../checkpoint/WorkspaceJournal.js';

export interface DoneGateConfig {
  /** When set, runs this command instead of auto-detection. */
  testCommand?: string;
  /** Skip running when the journal recorded no workspace mutations. */
  onlyWhenDirty?: boolean;
  /** Wall-clock budget for the verification shell command. */
  timeoutMs?: number;
}

export interface DetectedProjectCommands {
  test?: string;
  typecheck?: string;
}

export interface DoneGateResult {
  ok: boolean;
  skipped: boolean;
  command?: string;
  exitCode?: number;
  output?: string;
}

/** Read `package.json` scripts and infer a test / typecheck command. */
export function detectProjectCommands(workspace: string): DetectedProjectCommands {
  const pkgPath = path.join(workspace, 'package.json');
  if (!fs.existsSync(pkgPath)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { scripts?: Record<string, string> };
    const scripts = raw.scripts ?? {};
    const test = scripts.test?.trim();
    const typecheck = scripts.typecheck?.trim() || scripts['type-check']?.trim();
    return {
      ...(test ? { test: packageScriptCommand(workspace, 'test', test) } : {}),
      ...(typecheck ? { typecheck: packageScriptCommand(workspace, 'typecheck', typecheck) } : {}),
    };
  } catch {
    return {};
  }
}

function packageScriptCommand(workspace: string, name: string, scriptBody: string): string {
  const body = scriptBody.trim();
  if (/^(pnpm|npm|yarn|bun)\s/.test(body)) return body;
  const pnpm = fs.existsSync(path.join(workspace, 'pnpm-lock.yaml'));
  const runner = pnpm ? 'pnpm' : 'npm';
  if (name === 'test') return `${runner} test`;
  return `${runner} run ${name}`;
}

function composeCommand(detected: DetectedProjectCommands, override?: string): string | undefined {
  if (override?.trim()) return override.trim();
  const parts = [detected.test, detected.typecheck].filter((part): part is string => Boolean(part));
  if (parts.length === 0) return undefined;
  if (parts.length === 1) return parts[0];
  return parts.map((part, index) => (index === 0 ? part : `&& ${part}`)).join(' ');
}

export async function runDoneGate(input: {
  workspace: string;
  shell: ShellPort;
  journal: WorkspaceJournal;
  config?: DoneGateConfig;
  logger?: LoggerPort;
}): Promise<DoneGateResult> {
  const config = input.config ?? {};
  const dirty = input.journal.size > 0;
  if (config.onlyWhenDirty && !dirty) {
    return { ok: true, skipped: true };
  }

  const detected = detectProjectCommands(input.workspace);
  const command = composeCommand(detected, config.testCommand);
  if (!command) {
    return { ok: true, skipped: true };
  }

  input.logger?.info('done gate: running verification', { command, dirty });
  const result = await input.shell.exec(command, {
    cwd: input.workspace,
    timeoutMs: config.timeoutMs ?? 120_000,
  });
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
  if (result.code === 0) {
    return { ok: true, skipped: false, command, exitCode: 0, output };
  }
  return {
    ok: false,
    skipped: false,
    command,
    exitCode: result.code,
    output: output || `exit ${result.code}`,
  };
}

/** User-facing feedback when verification blocks completion. */
export function doneGateFailurePrompt(result: DoneGateResult): string {
  const cmd = result.command ?? 'verification';
  const code = result.exitCode ?? 1;
  const body = result.output?.slice(0, 12_000) ?? '(no output)';
  return (
    `Project verification failed before this could be marked complete.\n` +
    `Command: ${cmd}\n` +
    `Exit code: ${code}\n\n` +
    `${body}\n\n` +
    `Fix the failures and try again. Do not claim success until verification passes.`
  );
}

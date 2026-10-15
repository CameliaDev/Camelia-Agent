/**
 * Built-in shell tools.
 *
 * Commands are classified `privileged` so the approval gate sees them, and are
 * always time-boxed (whitepaper §3.7, §4.3).
 * @module
 */

import { assertWithinAllowRoots, type JsonValue } from '@camelia/core';

import type { Tool, ToolContext } from '../types.js';

interface ExecInput {
  command: string;
  cwd?: string;
  timeoutMs?: number;
}

interface TestInput {
  /** Defaults to `npm test`. */
  command?: string;
  timeoutMs?: number;
}

/** Cap captured output before it reaches the model context. */
const MAX_OUTPUT_CHARS = 20_000;

function clamp(text: string): string {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  const head = text.slice(0, MAX_OUTPUT_CHARS * 0.7);
  const tail = text.slice(-MAX_OUTPUT_CHARS * 0.3);
  return `${head}\n... [${text.length - MAX_OUTPUT_CHARS} chars truncated] ...\n${tail}`;
}

export const shellExecTool: Tool<ExecInput, JsonValue> = {
  name: 'shell.exec',
  description:
    'Run a shell command in the workspace and capture exit code and output (privileged — approval required). Use for builds, linters, git and project CLIs.',
  usage: [
    'shell.exec(command, cwd?, timeoutMs?)',
    '- command: the full command line, e.g. "npm run build".',
    '- cwd: workspace-relative or absolute path under workspace / extraAllowPaths (default workspace root).',
    '- Output is truncated at 20000 chars; timedOut/truncated flags tell you if it was cut.',
    '- cwd must stay inside allowed roots; FULL mode does not expand those roots. Destructive system commands are blocked by policy.',
  ].join('\n'),
  risk: 'privileged',
  reversible: false,
  schema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Command line to execute.' },
      cwd: { type: 'string', description: 'Working directory (workspace-relative or absolute under allow roots).' },
      timeoutMs: { type: 'integer', description: 'Timeout in milliseconds.' },
    },
    required: ['command'],
    additionalProperties: false,
  },
  async run(input, ctx: ToolContext) {
    const extras = ctx.extraAllowPaths ?? [];
    const cwd = assertWithinAllowRoots(ctx.workspace, input.cwd ?? '.', extras);
    const result = await ctx.shell.exec(input.command, {
      cwd,
      timeoutMs: input.timeoutMs,
    });
    return {
      code: result.code,
      stdout: clamp(result.stdout),
      stderr: clamp(result.stderr),
      durationMs: result.durationMs,
      timedOut: result.timedOut,
      truncated: result.truncated,
    };
  },
};

export const testRunTool: Tool<TestInput, JsonValue> = {
  name: 'test.run',
  description:
    'Run project tests and report pass/fail (privileged — approval required). Use for objective verification; never claim tests pass without calling it.',
  usage: [
    'test.run(command?, timeoutMs?)',
    '- command: the test command (default "npm test").',
    '- Returns { command, passed, code, stdout, stderr, timedOut }.',
    '- A passed result means exit code 0.',
  ].join('\n'),
  risk: 'privileged',
  reversible: false,
  schema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Test command (default "npm test").' },
      timeoutMs: { type: 'integer', description: 'Timeout in milliseconds.' },
    },
    additionalProperties: false,
  },
  async run(input, ctx: ToolContext) {
    const command = input.command ?? 'npm test';
    const result = await ctx.shell.exec(command, {
      cwd: ctx.workspace,
      timeoutMs: input.timeoutMs,
    });
    return {
      command,
      passed: result.code === 0,
      code: result.code,
      stdout: clamp(result.stdout),
      stderr: clamp(result.stderr),
      durationMs: result.durationMs,
      timedOut: result.timedOut,
    };
  },
};

export const shellTools: Tool<any, any>[] = [shellExecTool, testRunTool];
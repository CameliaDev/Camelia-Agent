import path from 'node:path';

/**
 * Math execution tool: run Python (sympy/numpy/matplotlib) in the workspace.
 *
 * Writes the snippet to .camelia/math/<ts>.py, runs it, and returns stdout
 * plus any saved figure paths. Matplotlib uses the non-interactive Agg backend
 * so it works headless.
 * @module
 */
import type { JsonValue } from '@camelia/core';
import type { Tool, ToolContext } from '../types.js';

interface MathExecInput {
  code: string;
  /** Optional filename hint for the script (no extension). */
  name?: string;
  timeoutMs?: number;
}

const MAX_OUTPUT_CHARS = 12_000;

function clamp(text: string): string {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  return `${text.slice(0, MAX_OUTPUT_CHARS)}\n... [${text.length - MAX_OUTPUT_CHARS} chars truncated] ...`;
}

export const mathExecTool: Tool<MathExecInput, JsonValue> = {
  name: 'math.exec',
  description:
    'Run Python math (sympy/numpy/scipy/matplotlib) in the workspace. Use for any calculation — never compute by hand.',
  usage: [
    'math.exec(code, name?, timeoutMs?)',
    '- code: full Python snippet. matplotlib uses Agg backend automatically.',
    '- To save a figure: plt.savefig("out.png", dpi=120, bbox_inches="tight")',
    '- To print results: use print(...). stdout is returned.',
    '- Returns { code, stdout, stderr, figurePaths, timedOut }.',
  ].join('\n'),
  risk: 'write',
  reversible: true,
  schema: {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'Python code to execute.' },
      name: { type: 'string', description: 'Optional script name hint.' },
      timeoutMs: { type: 'integer', description: 'Timeout in ms (default 30000).' },
    },
    required: ['code'],
    additionalProperties: false,
  },
  async run(input, ctx: ToolContext) {
    const ts = Date.now();
    const slug = (input.name ?? `calc_${ts}`).replace(/[^a-z0-9_-]/gi, '_');
    const relDir = '.camelia/math';
    const relFile = `${relDir}/${slug}.py`;
    const absFile = path.join(ctx.workspace, relFile);
    await ctx.fs.mkdir(path.join(ctx.workspace, relDir));
    const preamble = [
      'import matplotlib',
      'matplotlib.use("Agg")',
      'import matplotlib.pyplot as plt',
      'import numpy as np',
      'import sympy as sp',
      'print("--- python ok ---")',
    ].join('\n');
    const full = `${preamble}\n${input.code}\n`;
    await ctx.fs.writeFile(absFile, full);
    const result = await ctx.shell.exec(`python "${relFile}"`, {
      cwd: ctx.workspace,
      timeoutMs: input.timeoutMs ?? 30_000,
    });
    const figurePaths = (result.stdout + result.stderr).match(/[\w./-]+\.png/g) ?? [];
    return {
      script: relFile,
      code: result.code,
      stdout: clamp(result.stdout),
      stderr: clamp(result.stderr),
      figurePaths: [...new Set(figurePaths)],
      timedOut: result.timedOut,
    };
  },
};

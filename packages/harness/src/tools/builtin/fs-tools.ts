/**
 * Built-in filesystem tools.
 *
 * Every path is validated against the workspace root before use — the model never
 * gets to choose an unchecked path (whitepaper §3.8, §5.5).
 * @module
 */

import path from 'node:path';

import type { JsonValue } from '@camelia/core';
import { assertWithinAllowRoots, displayPathForAllowRoots } from '@camelia/core';

import type { Tool, ToolContext } from '../types.js';

interface ReadInput {
  path: string;
  /** 1-based first line to return. */
  offset?: number;
  /** Maximum number of lines to return. */
  limit?: number;
}

interface WriteInput {
  path: string;
  content: string;
}

interface EditInput {
  path: string;
  oldText: string;
  newText: string;
  replaceAll?: boolean;
}

interface ListInput {
  dir?: string;
  recursive?: boolean;
  maxEntries?: number;
}

const MAX_READ_LINES = 2000;

function resolve(ctx: ToolContext, p: string): { abs: string; rel: string } {
  if (ctx.unrestrictedFs) {
    const abs = path.isAbsolute(p) ? path.normalize(p) : path.resolve(ctx.workspace, p);
    return { abs, rel: abs };
  }
  const extras = ctx.extraAllowPaths ?? [];
  const abs = assertWithinAllowRoots(ctx.workspace, p, extras);
  return { abs, rel: displayPathForAllowRoots(ctx.workspace, abs, extras) };
}

export const fsReadTool: Tool<ReadInput, JsonValue> = {
  name: 'fs.read',
  description:
    'Read a text file from the workspace (read-only). Use when you need file contents; large files are returned partially, so read the parts you need.',
  usage: [
    'fs.read(path, offset?, limit?)',
    '- path: workspace-relative or absolute. Under ASK/readonly must stay in workspace / extraAllowPaths; under FULL (unrestrictedFs) any path on the machine is allowed. Read a file before editing it.',
    '- offset: 1-based first line to return (default 1).',
    '- limit: max lines to return (default 2000, capped at 2000).',
    '- Returns { path, content, totalLines, returnedLines, truncated }.',
    '- If the file is missing, the tool errors — locate the real path with search.glob first.',
  ].join('\n'),
  risk: 'read-only',
  reversible: true,
  schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace-relative file path.' },
      offset: { type: 'integer', description: '1-based first line to return.' },
      limit: { type: 'integer', description: 'Maximum number of lines to return.' },
    },
    required: ['path'],
    additionalProperties: false,
  },
  async run(input, ctx) {
    const { abs, rel } = resolve(ctx, input.path);
    if (!(await ctx.fs.exists(abs))) {
      const stat = await ctx.fs.stat(abs).catch(() => undefined);
      throw new Error(
        `File not found: ${rel}${stat ? '' : ' (path does not exist)'}. Use search.glob to locate the real path.`,
      );
    }
    const raw = await ctx.fs.readFile(abs);
    const allLines = raw.split('\n');
    const offset = Math.max(1, input.offset ?? 1);
    const limit = Math.min(input.limit ?? MAX_READ_LINES, MAX_READ_LINES);
    const slice = allLines.slice(offset - 1, offset - 1 + limit);
    return {
      path: rel,
      content: slice.join('\n'),
      totalLines: allLines.length,
      returnedLines: slice.length,
      truncated: offset - 1 + slice.length < allLines.length,
    };
  },
};

export const fsWriteTool: Tool<WriteInput, JsonValue> = {
  name: 'fs.write',
  description:
    'Create or overwrite a workspace file with given content (write, reversible). Use when a file must exist; parent directories are created automatically.',
  usage: [
    'fs.write(path, content)',
    '- path: workspace-relative or absolute. Under FULL any path is allowed; otherwise stay in workspace / extraAllowPaths. Parent dirs are created automatically.',
    '- content: the full file content. Overwrites any existing file.',
    '- Returns { path, bytes, lines, hash }.',
    '- Prefer fs.edit for small changes to an existing file.',
  ].join('\n'),
  risk: 'write',
  reversible: true,
  schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace-relative file path.' },
      content: { type: 'string', description: 'Full file content to write.' },
    },
    required: ['path', 'content'],
    additionalProperties: false,
  },
  async run(input, ctx) {
    const { abs, rel } = resolve(ctx, input.path);
    await ctx.journal.record(abs, rel);
    await ctx.fs.mkdir(path.dirname(abs));
    await ctx.fs.writeFile(abs, input.content);
    return {
      path: rel,
      bytes: Buffer.byteLength(input.content, 'utf8'),
      lines: input.content.split('\n').length,
      hash: await ctx.fs.hash(abs),
    };
  },
};

/**
 * Normalise a block for whitespace-tolerant matching: strip trailing whitespace
 * per line and compare line-by-line. This is how we survive the model getting
 * indentation slightly wrong without silently corrupting the file.
 */
function findFuzzy(text: string, needle: string): { start: number; end: number } | undefined {
  const textLines = text.split('\n');
  const needleLines = needle.split('\n').map((l) => l.trimEnd());
  const firstNeedle = needleLines[0];
  if (firstNeedle === undefined || needleLines.length === 0) return undefined;

  for (let i = 0; i + needleLines.length <= textLines.length; i += 1) {
    if (textLines[i]!.trimEnd() !== firstNeedle) continue;
    let matched = true;
    for (let j = 1; j < needleLines.length; j += 1) {
      if (textLines[i + j]!.trimEnd() !== needleLines[j]) {
        matched = false;
        break;
      }
    }
    if (!matched) continue;
    const before = textLines.slice(0, i).join('\n');
    const block = textLines.slice(i, i + needleLines.length).join('\n');
    const start = i === 0 ? 0 : before.length + 1;
    return { start, end: start + block.length };
  }
  return undefined;
}

export const fsEditTool: Tool<EditInput, JsonValue> = {
  name: 'fs.edit',
  description:
    'Replace an exact block in an existing file (write, reversible). Use for surgical edits; it fails loudly when the block is missing or ambiguous.',
  usage: [
    'fs.edit(path, oldText, newText, replaceAll?)',
    '- oldText must match the file; matching is whitespace-tolerant per line (trailing spaces ignored).',
    '- If oldText occurs more than once and replaceAll is not true, the tool errors — pass a larger unique block or set replaceAll: true.',
    '- If the block is not found, read the file again and copy the exact text — never guess.',
    '- Returns { path, replacements, hash }.',
  ].join('\n'),
  risk: 'write',
  reversible: true,
  schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace-relative file path.' },
      oldText: { type: 'string', description: 'Exact text to replace.' },
      newText: { type: 'string', description: 'Replacement text.' },
      replaceAll: { type: 'boolean', description: 'Replace every occurrence (default false).' },
    },
    required: ['path', 'oldText', 'newText'],
    additionalProperties: false,
  },
  async run(input, ctx) {
    const { abs, rel } = resolve(ctx, input.path);
    if (!(await ctx.fs.exists(abs))) {
      throw new Error(`File not found: ${rel}. Use fs.write to create it.`);
    }
    const original = await ctx.fs.readFile(abs);

    const exactCount = original.split(input.oldText).length - 1;
    let updated: string;
    let replacements: number;

    if (exactCount > 0) {
      if (exactCount > 1 && !input.replaceAll) {
        throw new Error(
          `oldText occurs ${exactCount} times in ${rel}. Provide a larger unique block or set replaceAll: true.`,
        );
      }
      updated = input.replaceAll
        ? original.split(input.oldText).join(input.newText)
        : original.replace(input.oldText, input.newText);
      replacements = input.replaceAll ? exactCount : 1;
    } else {
      const fuzzy = findFuzzy(original, input.oldText);
      if (!fuzzy) {
        throw new Error(
          `oldText not found in ${rel}. Read the file again and copy the exact block — do not guess its contents.`,
        );
      }
      updated = original.slice(0, fuzzy.start) + input.newText + original.slice(fuzzy.end);
      replacements = 1;
    }

    await ctx.journal.record(abs, rel);
    await ctx.fs.writeFile(abs, updated);
    return { path: rel, replacements, hash: await ctx.fs.hash(abs) };
  },
};

export const fsListTool: Tool<ListInput, JsonValue> = {
  name: 'fs.list',
  description:
    'List files and directories in the workspace (read-only). Use to survey what exists before planning changes.',
  usage: [
    'fs.list(dir?, recursive?, maxEntries?)',
    '- dir: workspace-relative directory (default ".").',
    '- recursive: walk subdirectories (default false). node_modules/.git/dist/coverage/.turbo are ignored.',
    '- maxEntries: cap on returned entries (default 200).',
    '- Returns { dir, count, entries }.',
  ].join('\n'),
  risk: 'read-only',
  reversible: true,
  schema: {
    type: 'object',
    properties: {
      dir: { type: 'string', description: 'Workspace-relative directory (default ".").' },
      recursive: { type: 'boolean', description: 'Walk subdirectories (default false).' },
      maxEntries: { type: 'integer', description: 'Cap on returned entries (default 200).' },
    },
    additionalProperties: false,
  },
  async run(input, ctx) {
    const target = input.dir ?? '.';
    const { abs, rel } = resolve(ctx, target);
    const entries = await ctx.fs.list(abs, {
      recursive: input.recursive ?? false,
      maxEntries: input.maxEntries ?? 200,
      ignore: ['node_modules', '.git', 'dist', 'coverage', '.turbo'],
    });
    return {
      dir: rel || '.',
      count: entries.length,
      entries,
    } as unknown as JsonValue;
  },
};

export const fsTools: Tool<any, any>[] = [fsReadTool, fsWriteTool, fsEditTool, fsListTool];
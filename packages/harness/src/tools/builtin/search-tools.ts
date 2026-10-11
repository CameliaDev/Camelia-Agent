/**
 * Built-in search tools.
 *
 * Whitepaper §5.5: the model must never invent a file path. `search.glob` and
 * `search.grep` produce ground truth that the model then selects from.
 * @module
 */

import type { JsonValue } from '@camelia/core';

import type { Tool, ToolContext } from '../types.js';

interface GlobInput {
  pattern: string;
  maxResults?: number;
}

interface GrepInput {
  pattern: string;
  glob?: string;
  ignoreCase?: boolean;
  maxResults?: number;
}

/** Cap on grep matches returned, so one broad pattern cannot blow the context. */
const MAX_GREP_RESULTS = 80;

export const searchGlobTool: Tool<GlobInput, JsonValue> = {
  name: 'search.glob',
  description:
    'Find files by glob pattern (read-only). Use to locate real paths instead of guessing them.',
  usage: [
    'search.glob(pattern, maxResults?)',
    '- pattern: POSIX glob, e.g. "src/**/*.ts".',
    '- maxResults: cap on returned paths (default 100).',
    '- Returns { count, paths }.',
  ].join('\n'),
  risk: 'read-only',
  reversible: true,
  schema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob pattern, POSIX separators.' },
      maxResults: { type: 'integer', description: 'Cap on returned paths (default 100).' },
    },
    required: ['pattern'],
    additionalProperties: false,
  },
  async run(input, ctx: ToolContext) {
    const paths = await ctx.search.glob(input.pattern, {
      cwd: ctx.workspace,
      ignore: ['node_modules', '.git', 'dist', 'coverage', '.turbo'],
      maxResults: input.maxResults ?? 100,
    });
    return { count: paths.length, paths };
  },
};

export const searchGrepTool: Tool<GrepInput, JsonValue> = {
  name: 'search.grep',
  description:
    'Search file contents with a regular expression (read-only). Use to find where a symbol is defined or used.',
  usage: [
    'search.grep(pattern, glob?, ignoreCase?, maxResults?)',
    '- pattern: a regular expression (regex, not a literal string).',
    '- glob: restrict to files matching a glob, e.g. "*.ts".',
    '- ignoreCase: case-insensitive match (default false).',
    '- maxResults: cap on returned matches (default 80).',
    '- Returns { count, fileCount, files, matches } with { path, line, column, text } per match.',
  ].join('\n'),
  risk: 'read-only',
  reversible: true,
  schema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Regular expression to search for.' },
      glob: { type: 'string', description: 'Restrict to files matching this glob.' },
      ignoreCase: { type: 'boolean', description: 'Case-insensitive match.' },
      maxResults: { type: 'integer', description: 'Cap on returned matches (default 80).' },
    },
    required: ['pattern'],
    additionalProperties: false,
  },
  async run(input, ctx: ToolContext) {
    const max = Math.min(input.maxResults ?? MAX_GREP_RESULTS, MAX_GREP_RESULTS);
    const matches = await ctx.search.grep(input.pattern, {
      cwd: ctx.workspace,
      glob: input.glob,
      ignoreCase: input.ignoreCase ?? false,
      regex: true,
      maxResults: max,
      ignore: ['node_modules', '.git', 'dist', 'coverage', '.turbo'],
    });
    const files = [...new Set(matches.map((m) => m.path))];
    return { count: matches.length, fileCount: files.length, files, matches } as unknown as JsonValue;
  },
};

export const searchTools: Tool<any, any>[] = [searchGlobTool, searchGrepTool];
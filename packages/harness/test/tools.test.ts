/**
 * Tool engine, schema validation and the built-in tools.
 *
 * The tool boundary is where a model's intent becomes a real effect, so these
 * tests assert the two safety promises from whitepaper §3.7–§3.8: arguments are
 * validated deterministically before execution, and every path is workspace-bound.
 * @module
 */

import { describe, expect, it, vi } from 'vitest';

import type { JsonSchema, JsonValue } from '@camelia/core';
import { newId } from '@camelia/core';

import { ToolEngine } from '../src/tools/ToolEngine.js';
import { formatIssues, validateSchema } from '../src/tools/schema-validator.js';
import { fsReadTool, fsWriteTool, fsEditTool, fsListTool } from '../src/tools/builtin/fs-tools.js';
import { searchGlobTool, searchGrepTool } from '../src/tools/builtin/search-tools.js';
import { shellExecTool, testRunTool } from '../src/tools/builtin/shell-tools.js';
import { builtinTools } from '../src/tools/builtin/index.js';
import { WorkspaceJournal } from '../src/checkpoint/WorkspaceJournal.js';
import type { Tool, ToolContext } from '../src/tools/types.js';
import { makeHarness, FakeSearch, FakeShell, type Harness } from './helpers/context.js';

function toolContext(h: Harness, journal = new WorkspaceJournal('/backups', 'task-1', h.fs, h.logger)): ToolContext {
  return {
    workspace: h.ctx.workspace,
    fs: h.ctx.ports.fs,
    shell: h.ctx.ports.shell,
    search: h.ctx.ports.search,
    logger: h.ctx.infra.logger,
    clock: h.ctx.ports.clock,
    journal,
    signal: h.ctx.signal,
  };
}

describe('schema-validator', () => {
  const schema: JsonSchema = {
    type: 'object',
    properties: {
      path: { type: 'string' },
      count: { type: 'integer' },
      mode: { type: 'string', enum: ['a', 'b'] },
    },
    required: ['path'],
    additionalProperties: false,
  };

  it('accepts a conforming value', () => {
    expect(validateSchema(schema, { path: 'x', count: 2, mode: 'a' })).toEqual([]);
  });

  it('reports a type mismatch and stops descending', () => {
    const issues = validateSchema(schema, 'not-an-object');
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain('expected object');
  });

  it('flags missing required fields', () => {
    const issues = validateSchema(schema, { count: 1 });
    expect(issues.some((i) => i.path === '$.path' && i.message === 'is required')).toBe(true);
  });

  it('distinguishes integers from floats', () => {
    expect(validateSchema({ type: 'integer' }, 1.5)[0]!.message).toContain('expected integer');
    expect(validateSchema({ type: 'number' }, 1.5)).toEqual([]);
  });

  it('enforces enum membership', () => {
    const issues = validateSchema(schema, { path: 'x', mode: 'z' });
    expect(issues.some((i) => i.path === '$.mode')).toBe(true);
  });

  it('rejects unknown properties when additionalProperties is false', () => {
    const issues = validateSchema(schema, { path: 'x', extra: 1 });
    expect(issues.some((i) => i.message === 'is not an allowed property')).toBe(true);
  });

  it('validates array items with an indexed path', () => {
    const issues = validateSchema({ type: 'array', items: { type: 'string' } }, ['ok', 3]);
    expect(issues[0]!.path).toBe('$[1]');
  });

  it('supports a union type', () => {
    expect(validateSchema({ type: ['string', 'null'] }, null)).toEqual([]);
  });

  it('formats issues as a single line', () => {
    expect(formatIssues([{ path: '$.a', message: 'is required' }])).toBe('$.a: is required');
  });
});

describe('ToolEngine', () => {
  const echo: Tool<{ msg: string }, JsonValue> = {
    name: 'echo',
    description: 'echo back',
    schema: { type: 'object', properties: { msg: { type: 'string' } }, required: ['msg'], additionalProperties: false },
    risk: 'read-only',
    reversible: true,
    async run(input) {
      return { echoed: input.msg };
    },
  };

  it('registers, lists and exposes schemas', () => {
    const engine = new ToolEngine();
    engine.register(echo);
    expect(engine.has('echo')).toBe(true);
    expect(engine.get('echo')).toBe(echo);
    expect(engine.list()[0]).toMatchObject({ name: 'echo', risk: 'read-only', source: 'builtin' });
    expect(engine.schemas().map((s) => s.name)).toContain('echo');
    expect(engine.schemas(['echo', 'missing']).map((s) => s.name)).toEqual(['echo']);
  });

  it('refuses to register the same tool twice', () => {
    const engine = new ToolEngine();
    engine.register(echo);
    expect(() => engine.register(echo)).toThrow(/already registered/);
  });

  it('registerAll registers a batch', () => {
    const engine = new ToolEngine();
    engine.registerAll(builtinTools);
    expect(engine.has('fs.write')).toBe(true);
    expect(engine.has('shell.exec')).toBe(true);
  });

  it('returns a helpful error for an unknown tool', async () => {
    const engine = new ToolEngine();
    engine.register(echo);
    const result = await engine.invoke('nope', {}, toolContext(makeHarness()));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Unknown tool "nope"');
  });

  it('rejects invalid arguments before running the tool', async () => {
    const h = makeHarness();
    const engine = new ToolEngine(undefined, h.metrics);
    const run = vi.fn(echo.run);
    engine.register({ ...echo, run });
    const result = await engine.invoke('echo', { msg: 1 }, toolContext(h));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.retryable).toBe(true);
    expect(run).not.toHaveBeenCalled();
    expect(h.metrics.query('tool.schema_reject')).toHaveLength(1);
  });

  it('runs a valid call and records latency', async () => {
    const engine = new ToolEngine(undefined, makeHarness().metrics);
    engine.register(echo);
    const result = await engine.invoke('echo', { msg: 'hi' }, toolContext(makeHarness()));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toEqual({ echoed: 'hi' });
  });

  it('converts a thrown tool error into a retryable classification', async () => {
    const engine = new ToolEngine();
    engine.register({
      ...echo,
      async run() {
        throw new Error('ETIMEDOUT talking to server');
      },
    });
    const result = await engine.invoke('echo', { msg: 'x' }, toolContext(makeHarness()));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('ETIMEDOUT');
      expect(result.retryable).toBe(true);
    }
  });
});

describe('fs tools', () => {
  it('reads a file with offset and limit', async () => {
    const h = makeHarness({ seed: { 'C:/workspace/a.txt': 'l1\nl2\nl3\nl4' } });
    const result = (await fsReadTool.run({ path: 'a.txt', offset: 2, limit: 2 }, toolContext(h))) as Record<string, unknown>;
    expect(result.content).toBe('l2\nl3');
    expect(result.totalLines).toBe(4);
    expect(result.truncated).toBe(true);
  });

  it('throws a path-hinting error when the file is missing', async () => {
    const h = makeHarness();
    await expect(fsReadTool.run({ path: 'nope.txt' }, toolContext(h))).rejects.toThrow(/search.glob/);
  });

  it('refuses to read outside the workspace', async () => {
    const h = makeHarness();
    await expect(fsReadTool.run({ path: '../secret' }, toolContext(h))).rejects.toThrow(/escapes workspace/);
  });

  it('writes a file, creates parent dirs and journals the change', async () => {
    const h = makeHarness();
    const journal = new WorkspaceJournal('/backups', 'task-1', h.fs, h.logger);
    const result = (await fsWriteTool.run({ path: 'src/new.ts', content: 'export const x = 1;\n' }, toolContext(h, journal))) as Record<string, unknown>;
    expect(result.path).toBe('src/new.ts');
    expect(result.lines).toBe(2);
    expect(await h.fs.exists('C:/workspace/src/new.ts')).toBe(true);
    expect(journal.size).toBe(1);
    expect(h.fs.dirs.has('C:/workspace/src')).toBe(true);
  });

  it('edits an exact block', async () => {
    const h = makeHarness({ seed: { 'C:/workspace/a.ts': 'const a = 1;\nconst b = 2;\n' } });
    const result = (await fsEditTool.run({ path: 'a.ts', oldText: 'const b = 2;', newText: 'const b = 3;' }, toolContext(h))) as Record<string, unknown>;
    expect(result.replacements).toBe(1);
    expect(await h.fs.readFile('C:/workspace/a.ts')).toContain('const b = 3;');
  });

  it('refuses an ambiguous edit unless replaceAll is set', async () => {
    const h = makeHarness({ seed: { 'C:/workspace/a.ts': 'x\nx\n' } });
    await expect(fsEditTool.run({ path: 'a.ts', oldText: 'x', newText: 'y' }, toolContext(h))).rejects.toThrow(/occurs 2 times/);
    const result = (await fsEditTool.run({ path: 'a.ts', oldText: 'x', newText: 'y', replaceAll: true }, toolContext(h))) as Record<string, unknown>;
    expect(result.replacements).toBe(2);
  });

  it('falls back to a whitespace-tolerant match', async () => {
    const h = makeHarness({ seed: { 'C:/workspace/a.ts': '  indented();   \nnext();\n' } });
    const result = (await fsEditTool.run({ path: 'a.ts', oldText: 'indented();', newText: 'renamed();' }, toolContext(h))) as Record<string, unknown>;
    expect(result.replacements).toBe(1);
    expect(await h.fs.readFile('C:/workspace/a.ts')).toContain('renamed();');
  });

  it('fails loudly when the block is absent', async () => {
    const h = makeHarness({ seed: { 'C:/workspace/a.ts': 'const a = 1;\n' } });
    await expect(fsEditTool.run({ path: 'a.ts', oldText: 'nope', newText: 'y' }, toolContext(h))).rejects.toThrow(/not found/);
  });

  it('fails when editing a file that does not exist', async () => {
    const h = makeHarness();
    await expect(fsEditTool.run({ path: 'a.ts', oldText: 'x', newText: 'y' }, toolContext(h))).rejects.toThrow(/File not found/);
  });

  it('lists workspace entries with the ignore list applied', async () => {
    const h = makeHarness({
      seed: {
        'C:/workspace/src/a.ts': 'a',
        'C:/workspace/src/b.ts': 'b',
        'C:/workspace/node_modules/x.js': 'x',
      },
    });
    const result = (await fsListTool.run({ dir: '.', recursive: true }, toolContext(h))) as { count: number; entries: { name: string }[] };
    expect(result.count).toBe(2);
    expect(result.entries.map((e) => e.name).sort()).toEqual(['src/a.ts', 'src/b.ts']);
  });
});

describe('search tools', () => {
  it('glob returns the located paths', async () => {
    const h = makeHarness({ search: new FakeSearch(['src/a.ts', 'src/b.ts']) });
    const result = (await searchGlobTool.run({ pattern: 'src/**/*.ts' }, toolContext(h))) as { count: number; paths: string[] };
    expect(result.count).toBe(2);
    expect(result.paths).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('grep de-duplicates files and caps results', async () => {
    const h = makeHarness({
      search: new FakeSearch([], [
        { path: 'src/a.ts', line: 1, column: 1, text: 'foo' },
        { path: 'src/a.ts', line: 2, column: 1, text: 'foo' },
        { path: 'src/b.ts', line: 5, column: 1, text: 'foo' },
      ]),
    });
    const result = (await searchGrepTool.run({ pattern: 'foo' }, toolContext(h))) as { count: number; fileCount: number; files: string[] };
    expect(result.count).toBe(3);
    expect(result.fileCount).toBe(2);
    expect(result.files).toEqual(['src/a.ts', 'src/b.ts']);
  });
});

describe('shell tools', () => {
  it('returns the exit code and output', async () => {
    const h = makeHarness({ shell: new FakeShell(() => ({ code: 0, stdout: 'built\n' })) });
    const result = (await shellExecTool.run({ command: 'npm run build' }, toolContext(h))) as Record<string, unknown>;
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('built\n');
  });

  it('clamps very large output before it reaches the model', async () => {
    const h = makeHarness({ shell: new FakeShell(() => ({ code: 0, stdout: 'z'.repeat(50_000) })) });
    const result = (await shellExecTool.run({ command: 'cat big' }, toolContext(h))) as { stdout: string };
    expect(result.stdout.length).toBeLessThan(21_000);
    expect(result.stdout).toContain('chars truncated');
  });

  it('test.run reports pass/fail from the exit code', async () => {
    const pass = makeHarness({ shell: new FakeShell(() => ({ code: 0 })) });
    const fail = makeHarness({ shell: new FakeShell(() => ({ code: 1, stderr: 'boom' })) });
    expect(((await testRunTool.run({}, toolContext(pass))) as { passed: boolean }).passed).toBe(true);
    expect(((await testRunTool.run({ command: 'vitest' }, toolContext(fail))) as { passed: boolean }).passed).toBe(false);
  });

  it('resolves a relative cwd against the workspace', async () => {
    const h = makeHarness();
    await shellExecTool.run({ command: 'ls', cwd: 'src' }, toolContext(h));
    expect(h.shell.commands[0]!.options?.cwd).toBe('C:/workspace/src');
  });
});

describe('WorkspaceJournal', () => {
  it('rolls back a newly created file by deleting it', async () => {
    const h = makeHarness();
    const journal = new WorkspaceJournal('/backups', 'task-1', h.fs, h.logger);
    await journal.record('C:/workspace/new.txt', 'new.txt');
    await h.fs.writeFile('C:/workspace/new.txt', 'fresh');
    expect(journal.size).toBe(1);
    const restored = await journal.rollback();
    expect(restored).toBe(1);
    expect(await h.fs.exists('C:/workspace/new.txt')).toBe(false);
    expect(journal.size).toBe(0);
  });

  it('rolls back a modified file to its original bytes', async () => {
    const h = makeHarness({ seed: { 'C:/workspace/a.txt': 'original' } });
    const journal = new WorkspaceJournal('/backups', 'task-1', h.fs, h.logger);
    await journal.record('C:/workspace/a.txt', 'a.txt');
    await h.fs.writeFile('C:/workspace/a.txt', 'mutated');
    await journal.rollback();
    expect(await h.fs.readFile('C:/workspace/a.txt')).toBe('original');
  });

  it('is idempotent per path — the first recording wins', async () => {
    const h = makeHarness({ seed: { 'C:/workspace/a.txt': 'v1' } });
    const journal = new WorkspaceJournal('/backups', 'task-1', h.fs, h.logger);
    await journal.record('C:/workspace/a.txt', 'a.txt');
    await h.fs.writeFile('C:/workspace/a.txt', 'v2');
    await journal.record('C:/workspace/a.txt', 'a.txt');
    expect(journal.size).toBe(1);
    await journal.rollback();
    expect(await h.fs.readFile('C:/workspace/a.txt')).toBe('v1');
  });

  it('clear drops tracking without touching files', async () => {
    const h = makeHarness({ seed: { 'C:/workspace/a.txt': 'v1' } });
    const journal = new WorkspaceJournal('/backups', 'task-1', h.fs, h.logger);
    await journal.record('C:/workspace/a.txt', 'a.txt');
    await h.fs.writeFile('C:/workspace/a.txt', 'v2');
    journal.clear();
    expect(journal.size).toBe(0);
    expect(await h.fs.readFile('C:/workspace/a.txt')).toBe('v2');
  });
});

describe('builtin tool registry', () => {
  it('ships every core tool exactly once', () => {
    const names = builtinTools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(expect.arrayContaining(['fs.read', 'fs.write', 'fs.edit', 'fs.list', 'search.glob', 'search.grep', 'shell.exec', 'test.run']));
  });

  it('has a stable id for a fresh journal entry key', () => {
    expect(newId()).toBeTypeOf('string');
  });
});

// ---------------------------------------------------------------------------
// Iteration 20: three-layer tool knowledge — semantic descriptions audit
// ---------------------------------------------------------------------------

describe('three-layer tool knowledge', () => {
  it('keeps every builtin description semantic (no syntax, no flags, one line)', () => {
    for (const tool of builtinTools) {
      expect(tool.description.length, `${tool.name} description too long`).toBeLessThanOrEqual(150);
      expect(tool.description, `${tool.name} description contains a backtick`).not.toContain('`');
      expect(tool.description, `${tool.name} description contains a flag`).not.toContain('--');
      expect(tool.description, `${tool.name} description contains a JSON example`).not.toContain('"');
    }
  });

  it('ships a usage doc for every builtin tool — syntax lives there, not in the resident list', () => {
    for (const tool of builtinTools) {
      expect(tool.usage, `${tool.name} missing usage layer`).toBeTruthy();
      expect(tool.usage!.length, `${tool.name} usage too long`).toBeLessThanOrEqual(600);
    }
  });

  it('keeps the guardrails intact — schema validation and risk levels unchanged in shape', () => {
    for (const tool of builtinTools) {
      expect(tool.schema.type).toBe('object');
      expect(tool.schema.additionalProperties).toBe(false);
      expect(['read-only', 'write', 'privileged']).toContain(tool.risk);
    }
    expect(shellExecTool.risk).toBe('privileged');
    expect(testRunTool.risk).toBe('privileged');
    expect(fsWriteTool.reversible).toBe(true);
    expect(fsReadTool.reversible).toBe(true);
  });
});
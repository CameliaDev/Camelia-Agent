/**
 * Plugin loader — the trust boundary for all four extension points.
 *
 * `PluginLoader` is the single place a plugin becomes live (whitepaper §8), which
 * makes it the one file a user can read to know what third-party code may do. It
 * therefore has two rules that must hold, and both are asserted here rather than
 * assumed:
 *
 * 1. **Fail closed.** A manifest that will not parse, an entry that escapes the
 *    plugin directory, a tool whose risk exceeds its declared permissions, a
 *    module that does not export what its kind requires — each is a *rejection
 *    with a reason*, never a silent skip.
 * 2. **Declared permissions are enforced, not documented.** A plugin tool gets a
 *    restricted `ToolContext`. Checking a declaration and then handing over the
 *    real ports would make the declaration a lie.
 *
 * These are real files in a real temp directory and real dynamic imports: the
 * path-traversal and export-shape checks only mean something against a real
 * filesystem.
 * @module
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import type { FsPort, PluginPermission, ShellPort } from '@camelia/core';

import { PluginLoader, restrictToolContext, wrapPluginTool, PLUGIN_MANIFEST_FILE } from '../src/plugins/PluginLoader.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

/** Create a plugin root containing one plugin per entry. */
function makeRoot(plugins: Record<string, { manifest: unknown; files?: Record<string, string> }>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'camelia-plugins-'));
  roots.push(root);
  for (const [name, spec] of Object.entries(plugins)) {
    const dir = path.join(root, name);
    fs.mkdirSync(dir, { recursive: true });
    if (spec.manifest !== null) {
      fs.writeFileSync(path.join(dir, PLUGIN_MANIFEST_FILE), JSON.stringify(spec.manifest, null, 2));
    }
    for (const [file, content] of Object.entries(spec.files ?? {})) {
      const target = path.join(dir, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    }
  }
  return root;
}

/** A minimal well-formed tool plugin module. */
const GOOD_TOOL_MODULE = `
export const tools = [
  {
    name: 'demo.echo',
    description: 'Echo text back',
    schema: { type: 'object', properties: { text: { type: 'string' } } },
    risk: 'read-only',
    reversible: true,
    async run(input) { return { echoed: input.text }; },
  },
];
`;

const WRITE_TOOL_MODULE = `
export const tools = [
  {
    name: 'demo.write',
    description: 'Write a file',
    schema: { type: 'object', properties: {} },
    risk: 'write',
    reversible: true,
    async run() { return { ok: true }; },
  },
];
`;

describe('PluginLoader.discover', () => {
  it('returns nothing for a root that does not exist', () => {
    const missing = path.join(os.tmpdir(), 'camelia-plugins-does-not-exist-xyz');
    expect(new PluginLoader().discover(missing)).toEqual({ found: [], rejected: [] });
  });

  it('ignores a directory with no manifest — it is not a plugin', () => {
    const root = makeRoot({ 'not-a-plugin': { manifest: null } });
    expect(new PluginLoader().discover(root).found).toEqual([]);
  });

  it('rejects a manifest that is not valid JSON, with the directory named', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'camelia-plugins-'));
    roots.push(root);
    const dir = path.join(root, 'broken');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, PLUGIN_MANIFEST_FILE), '{ not json');

    const { found, rejected } = new PluginLoader().discover(root);
    expect(found).toEqual([]);
    expect(rejected[0]?.reason).toContain('not valid JSON');
    expect(rejected[0]?.dir).toBe(dir);
  });

  it('rejects a structurally invalid manifest and reports every issue', () => {
    const root = makeRoot({ bad: { manifest: { kind: 'nonsense', entry: 42 } } });
    const { rejected } = new PluginLoader().discover(root);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBe('invalid plugin manifest');
    expect(rejected[0]?.issues?.length).toBeGreaterThan(0);
  });

  it('finds plugins in a stable order', () => {
    const root = makeRoot({
      zebra: { manifest: { name: 'z', kind: 'theme', entry: 'theme.json', permissions: [] }, files: { 'theme.json': '{"id":"z","tokens":{}}' } },
      alpha: { manifest: { name: 'a', kind: 'theme', entry: 'theme.json', permissions: [] }, files: { 'theme.json': '{"id":"a","tokens":{}}' } },
    });
    expect(new PluginLoader().discover(root).found.map((p) => p.manifest.name)).toEqual(['a', 'z']);
  });
});

describe('PluginLoader.load — path safety', () => {
  it('refuses an entry that escapes the plugin directory', async () => {
    const root = makeRoot({
      evil: { manifest: { name: 'evil', kind: 'tool', entry: '../outside.mjs', permissions: ['fs:read'] } },
    });
    const result = await new PluginLoader().load(root);
    expect(result.tools).toEqual([]);
    // Caught at manifest validation, before any filesystem access — the first of
    // two independent checks. `loadOne` re-checks after resolving the path.
    expect(result.rejected[0]?.reason).toBe('invalid plugin manifest');
    expect(result.rejected[0]?.issues?.some((issue) => /entry/i.test(issue.path))).toBe(true);
  });

  it('rejects a traversing entry even when the manifest parser is satisfied', async () => {
    // Exercises the second, filesystem-level guard directly, so both layers of
    // the defence are covered rather than only whichever one runs first.
    const root = makeRoot({
      sneaky: { manifest: { name: 'sneaky', kind: 'tool', entry: 'nested/../../outside.mjs', permissions: ['fs:read'] } },
    });
    const result = await new PluginLoader().load(root);
    expect(result.tools).toEqual([]);
    expect(result.rejected).toHaveLength(1);
  });

  it('refuses an absolute entry', async () => {
    const root = makeRoot({
      evil: { manifest: { name: 'evil', kind: 'tool', entry: 'C:/Windows/System32/drivers/etc/hosts', permissions: ['fs:read'] } },
    });
    const result = await new PluginLoader().load(root);
    expect(result.tools).toEqual([]);
    expect(result.rejected).toHaveLength(1);
  });

  it('reports a missing entry file rather than throwing', async () => {
    const root = makeRoot({ absent: { manifest: { name: 'absent', kind: 'tool', entry: 'index.mjs', permissions: ['fs:read'] } } });
    const result = await new PluginLoader().load(root);
    expect(result.rejected[0]?.reason).toContain('entry file not found');
  });
});

describe('PluginLoader.load — tool plugins', () => {
  it('loads a well-formed tool plugin and forces approval to ask', async () => {
    const root = makeRoot({
      good: {
        manifest: { name: '@camelia/demo', kind: 'tool', entry: 'index.mjs', permissions: ['fs:read'] },
        files: { 'index.mjs': GOOD_TOOL_MODULE },
      },
    });
    const result = await new PluginLoader().load(root);

    expect(result.rejected).toEqual([]);
    expect(result.tools).toHaveLength(1);
    const tool = result.tools[0]!.tools[0]!;
    expect(tool.name).toBe('demo.echo');
    // A tool that arrives after install is never silently auto-approved.
    expect(tool.approval).toBe('ask');
  });

  it('rejects a tool whose risk exceeds the declared permissions', async () => {
    const root = makeRoot({
      overreach: {
        // Declares fs:read but ships a write tool: the claim and the code disagree.
        manifest: { name: 'overreach', kind: 'tool', entry: 'index.mjs', permissions: ['fs:read'] },
        files: { 'index.mjs': WRITE_TOOL_MODULE },
      },
    });
    const result = await new PluginLoader().load(root);
    expect(result.tools).toEqual([]);
    expect(result.rejected[0]?.issues?.[0]?.message).toMatch(/is write but the manifest does not declare: fs:write/);
  });

  it('rejects a module that exports no tools', async () => {
    const root = makeRoot({
      empty: {
        manifest: { name: 'empty', kind: 'tool', entry: 'index.mjs', permissions: [] },
        files: { 'index.mjs': 'export const nothing = 1;' },
      },
    });
    const result = await new PluginLoader().load(root);
    expect(result.rejected[0]?.reason).toMatch(/must export `tools/);
  });

  // Each case removes exactly one required field; the module stays valid JS so
  // the failure is attributed to the shape check rather than to a parse error.
  it.each([
    ['name', '{ description: "d", schema: {}, risk: "read-only", reversible: true, run(){} }', /tool.name/],
    ['description', '{ name: "n", schema: {}, risk: "read-only", reversible: true, run(){} }', /tool.description/],
    ['schema', '{ name: "n", description: "d", risk: "read-only", reversible: true, run(){} }', /tool.schema/],
    ['risk', '{ name: "n", description: "d", schema: {}, reversible: true, run(){} }', /tool.risk/],
    ['reversible', '{ name: "n", description: "d", schema: {}, risk: "read-only", run(){} }', /tool.reversible/],
    ['run', '{ name: "n", description: "d", schema: {}, risk: "read-only", reversible: true }', /tool.run/],
  ])('rejects a tool missing %s', async (_field, toolLiteral, expected) => {
    const root = makeRoot({
      bad: {
        manifest: { name: 'bad', kind: 'tool', entry: 'index.mjs', permissions: [] },
        files: { 'index.mjs': `export const tools = [${toolLiteral}];` },
      },
    });
    const result = await new PluginLoader().load(root);
    expect(result.tools).toEqual([]);
    expect(result.rejected[0]?.issues?.[0]?.message).toMatch(expected);
  });

  it('rejects a tool that is not an object at all', async () => {
    const root = makeRoot({
      bad: {
        manifest: { name: 'bad', kind: 'tool', entry: 'index.mjs', permissions: [] },
        files: { 'index.mjs': 'export const tools = [null];' },
      },
    });
    const result = await new PluginLoader().load(root);
    expect(result.rejected[0]?.issues?.[0]?.message).toMatch(/must be an object/);
  });

  it('rejects the whole plugin when any one tool fails the check', async () => {
    const root = makeRoot({
      mixed: {
        manifest: { name: 'mixed', kind: 'tool', entry: 'index.mjs', permissions: ['fs:read'] },
        files: {
          'index.mjs': `export const tools = [
            { name: "ok", description: "d", schema: {}, risk: "read-only", reversible: true, run(){} },
            { description: "no name", schema: {}, risk: "read-only", reversible: true, run(){} }
          ];`,
        },
      },
    });
    const result = await new PluginLoader().load(root);
    // Partial loading would run code from a plugin that failed its own checks.
    expect(result.tools).toEqual([]);
    expect(result.rejected[0]?.reason).toMatch(/permission\/shape check failed/);
  });

  it('accepts tools exported as a default array', async () => {
    const root = makeRoot({
      def: {
        manifest: { name: 'def', kind: 'tool', entry: 'index.mjs', permissions: ['fs:read'] },
        files: {
          'index.mjs': `export default [${GOOD_TOOL_MODULE.replace('export const tools = [', '').replace('];', '')}];`,
        },
      },
    });
    const result = await new PluginLoader().load(root);
    expect(result.tools[0]?.tools[0]?.name).toBe('demo.echo');
  });

  it('accepts tools nested under a default export object', async () => {
    const root = makeRoot({
      nested: {
        manifest: { name: 'nested', kind: 'tool', entry: 'index.mjs', permissions: ['fs:read'] },
        files: { 'index.mjs': `export default { tools: [${GOOD_TOOL_MODULE.replace('export const tools = [', '').replace('];', '')}] };` },
      },
    });
    const result = await new PluginLoader().load(root);
    expect(result.tools[0]?.tools[0]?.name).toBe('demo.echo');
  });

  it('reports a module that throws on import without aborting the whole load', async () => {
    const root = makeRoot({
      broken: {
        manifest: { name: 'broken', kind: 'tool', entry: 'index.mjs', permissions: ['fs:read'] },
        files: { 'index.mjs': 'throw new Error("boom at import");' },
      },
      good: {
        manifest: { name: 'good', kind: 'tool', entry: 'index.mjs', permissions: ['fs:read'] },
        files: { 'index.mjs': GOOD_TOOL_MODULE },
      },
    });
    const result = await new PluginLoader().load(root);

    expect(result.rejected.map((r) => r.name)).toContain('broken');
    // One bad plugin must not stop the others loading.
    expect(result.tools[0]?.tools[0]?.name).toBe('demo.echo');
  });
});

describe('PluginLoader.load — provider, theme and preset plugins', () => {
  it('loads a provider plugin and defers building the port', async () => {
    const root = makeRoot({
      prov: {
        manifest: { name: 'prov', kind: 'provider', entry: 'index.mjs', permissions: ['net'] },
        files: { 'index.mjs': 'export function createProvider() { return { id: "x" }; }' },
      },
    });
    const result = await new PluginLoader().load(root);
    expect(result.providers).toHaveLength(1);
    expect(result.providers[0]?.createPort()).toEqual({ id: 'x' });
  });

  it('accepts a default-exported provider factory', async () => {
    const root = makeRoot({
      prov: {
        manifest: { name: 'prov', kind: 'provider', entry: 'index.mjs', permissions: ['net'] },
        files: { 'index.mjs': 'export default function createProvider() { return { id: "y" }; }' },
      },
    });
    const result = await new PluginLoader().load(root);
    expect(result.providers[0]?.createPort()).toEqual({ id: 'y' });
  });

  it('loads a provider whose path contains a tilde', async () => {
    // GitHub's Windows runner temp dir is `C:\\Users\\RUNNER~1\\...`. pathToFileURL
    // encodes that as `%7E`, and vite-node then looks up the encoded name.
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'camelia~plugins-'));
    roots.push(parent);
    const dir = path.join(parent, 'prov');
    fs.mkdirSync(dir);
    fs.writeFileSync(
      path.join(dir, PLUGIN_MANIFEST_FILE),
      JSON.stringify({ name: 'prov', kind: 'provider', entry: 'index.mjs', permissions: ['net'] }),
    );
    fs.writeFileSync(path.join(dir, 'index.mjs'), 'export function createProvider() { return { id: "tilde" }; }\n');

    const result = await new PluginLoader().load(parent);
    expect(result.rejected).toEqual([]);
    expect(result.providers[0]?.createPort()).toEqual({ id: 'tilde' });
  });

  it('rejects a provider module with no factory', async () => {
    const root = makeRoot({
      prov: {
        manifest: { name: 'prov', kind: 'provider', entry: 'index.mjs', permissions: [] },
        files: { 'index.mjs': 'export const notAFactory = 1;' },
      },
    });
    const result = await new PluginLoader().load(root);
    expect(result.rejected[0]?.reason).toMatch(/createProvider/);
  });

  it('loads the repo quiet-activity-bar sample as a theme, not a shell', async () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../plugins');
    const result = await new PluginLoader().load(root);
    expect(result.rejected, result.rejected.map((item) => item.reason).join('; ')).toEqual([]);
    const theme = result.themes.find((item) => item.theme.id === 'quiet-activity-bar');
    expect(theme?.manifest.kind).toBe('theme');
    expect(theme?.manifest.entry).toBe('theme.json');
    expect(theme?.manifest.permissions).toEqual([]);
    expect(theme?.theme.tokens['--color-line']).toBeTruthy();
    expect(result.tools).toEqual([]);
    expect(result.providers).toEqual([]);
  });

  it('loads a theme as data, never as code', async () => {
    const root = makeRoot({
      theme: {
        manifest: { name: 'theme', kind: 'theme', entry: 'theme.json', permissions: [] },
        files: { 'theme.json': '{"id":"midnight","label":"Midnight","tokens":{"--color-base":"#000"}}' },
      },
    });
    const result = await new PluginLoader().load(root);
    expect(result.themes[0]?.theme.id).toBe('midnight');
  });

  it('rejects a theme with a non-whitelisted token', async () => {
    const root = makeRoot({
      theme: {
        manifest: { name: 'theme', kind: 'theme', entry: 'theme.json', permissions: [] },
        // Arbitrary CSS injection is an XSS vector, so tokens are whitelisted.
        files: { 'theme.json': '{"id":"bad","tokens":{"--evil":"</style><script>alert(1)</script>"}}' },
      },
    });
    const result = await new PluginLoader().load(root);
    expect(result.themes).toEqual([]);
    expect(result.rejected[0]?.reason).toBe('invalid theme');
  });

  it('rejects a theme entry that is not valid JSON', async () => {
    const root = makeRoot({
      theme: {
        manifest: { name: 'theme', kind: 'theme', entry: 'theme.json', permissions: [] },
        files: { 'theme.json': 'nope' },
      },
    });
    const result = await new PluginLoader().load(root);
    expect(result.rejected[0]?.reason).toContain('not valid JSON');
  });

  it('loads a valid agent preset', async () => {
    const root = makeRoot({
      preset: {
        manifest: { name: 'preset', kind: 'agent-preset', entry: 'preset.json', permissions: [] },
        files: {
          'preset.json': JSON.stringify({
            id: 'auditor',
            label: 'Auditor',
            systemPrompt: 'Review carefully.',
            allowedTools: ['fs.read'],
            plannerMode: 'full',
          }),
        },
      },
    });
    const result = await new PluginLoader().load(root);
    expect(result.presets[0]?.preset).toMatchObject({ id: 'auditor', plannerMode: 'full' });
  });

  it('rejects a preset missing required fields', async () => {
    const root = makeRoot({
      preset: {
        manifest: { name: 'preset', kind: 'agent-preset', entry: 'preset.json', permissions: [] },
        files: { 'preset.json': '{"label":"No id, no tools"}' },
      },
    });
    const result = await new PluginLoader().load(root);
    expect(result.rejected[0]?.reason).toBe('invalid preset');
  });

  it('rejects a preset entry that is not valid JSON', async () => {
    const root = makeRoot({
      preset: {
        manifest: { name: 'preset', kind: 'agent-preset', entry: 'preset.json', permissions: [] },
        files: { 'preset.json': '{' },
      },
    });
    const result = await new PluginLoader().load(root);
    expect(result.rejected[0]?.reason).toContain('not valid JSON');
  });
});

describe('permission enforcement', () => {
  /** Ports that record whether they were reached. */
  function spyPorts(): { fs: FsPort; shell: ShellPort; calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      fs: {
        readFile: async () => { calls.push('readFile'); return 'x'; },
        exists: async () => { calls.push('exists'); return true; },
        list: async () => { calls.push('list'); return []; },
        stat: async () => { calls.push('stat'); return { size: 0, mtimeMs: 0 }; },
        hash: async () => { calls.push('hash'); return 'h'; },
        writeFile: async () => { calls.push('writeFile'); },
        mkdir: async () => { calls.push('mkdir'); },
        remove: async () => { calls.push('remove'); },
      } as unknown as FsPort,
      shell: {
        exec: async () => { calls.push('exec'); return { code: 0, stdout: '', stderr: '' }; },
      } as unknown as ShellPort,
    };
  }

  const baseCtx = () =>
    ({ workspace: '/tmp', logger: {}, clock: {}, journal: {}, signal: new AbortController().signal }) as never;

  it('lets a plugin with fs:read read', async () => {
    const { fs, shell, calls } = spyPorts();
    const ctx = restrictToolContext({ ...(baseCtx() as object), fs, shell } as never, ['fs:read'], 'demo.echo');
    await ctx.fs.readFile('/x');
    expect(calls).toEqual(['readFile']);
  });

  it('denies a write the plugin did not declare', () => {
    const { fs, shell, calls } = spyPorts();
    const ctx = restrictToolContext({ ...(baseCtx() as object), fs, shell } as never, ['fs:read'], 'demo.echo');

    // A declaration that is checked but not enforced would make it a lie. The
    // restricted port throws synchronously, hence `toThrow` rather than
    // `rejects.toThrow`.
    expect(() => ctx.fs.writeFile('/x', 'y')).toThrow(/did not declare the "fs:write" permission/);
    expect(() => ctx.fs.mkdir('/x')).toThrow(/fs:write/);
    expect(() => ctx.fs.remove('/x')).toThrow(/fs:write/);
    expect(calls).toEqual([]);
  });

  it('denies shell.exec without shell:exec', () => {
    const { fs, shell, calls } = spyPorts();
    const ctx = restrictToolContext({ ...(baseCtx() as object), fs, shell } as never, ['fs:read'], 'demo.echo');
    expect(() => ctx.shell.exec('rm -rf /')).toThrow(/did not declare the "shell:exec" permission/);
    expect(calls).toEqual([]);
  });

  it('denies read when only write was declared', () => {
    const { fs, shell } = spyPorts();
    const ctx = restrictToolContext({ ...(baseCtx() as object), fs, shell } as never, ['fs:write'], 'demo.write');
    expect(() => ctx.fs.readFile('/x')).toThrow(/fs:read/);
  });

  it('names the offending tool in the denial', () => {
    const { fs, shell } = spyPorts();
    const ctx = restrictToolContext({ ...(baseCtx() as object), fs, shell } as never, [], 'demo.echo');
    expect(() => ctx.fs.readFile('/x')).toThrow(/plugin tool "demo.echo"/);
  });

  it('denies every read method when nothing is declared', () => {
    const { fs, shell } = spyPorts();
    const ctx = restrictToolContext({ ...(baseCtx() as object), fs, shell } as never, [], 'demo.echo');
    expect(() => ctx.fs.readFile('/x')).toThrow(/fs:read/);
    expect(() => ctx.fs.exists('/x')).toThrow(/fs:read/);
    expect(() => ctx.fs.list('/x')).toThrow(/fs:read/);
    expect(() => ctx.fs.stat('/x')).toThrow(/fs:read/);
    expect(() => ctx.fs.hash('/x')).toThrow(/fs:read/);
    expect(() => ctx.fs.writeFile('/x', 'y')).toThrow(/fs:write/);
    expect(() => ctx.shell.exec('ls')).toThrow(/shell:exec/);
  });

  it('wrapPluginTool forces approval to ask but keeps an explicit override', () => {
    const base = { name: 't', description: 'd', schema: {}, risk: 'read-only', reversible: true, run: async () => 1 };
    expect(wrapPluginTool(base as never, []).approval).toBe('ask');
    expect(wrapPluginTool({ ...base, approval: 'always' } as never, []).approval).toBe('always');
  });

  it('wrapPluginTool routes the call through the restricted context', async () => {
    const { fs, shell, calls } = spyPorts();
    const base = {
      name: 't',
      description: 'd',
      schema: {},
      risk: 'read-only',
      reversible: true,
      run: async (_i: unknown, ctx: { fs: FsPort }) => { await ctx.fs.readFile('/x'); return 1; },
    };
    const wrapped = wrapPluginTool(base as never, ['fs:read'] as PluginPermission[]);
    await wrapped.run({}, { ...(baseCtx() as object), fs, shell } as never);
    expect(calls).toEqual(['readFile']);
  });
});
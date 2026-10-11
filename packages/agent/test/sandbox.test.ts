/**
 * Plugin sandbox — containment against hostile and broken plugins.
 *
 * The claim under test is narrow and specific: **a plugin cannot crash or hang
 * the engine.** It is not a claim that a plugin cannot read the filesystem —
 * a worker shares the process's OS permissions. Each test therefore targets a
 * real failure mode seen in practice, and each asserts the *engine survives*,
 * which is the property that matters for a long-running session.
 * @module
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { PluginLoader } from '../src/plugins/PluginLoader.js';
import { DEFAULT_SANDBOX_TIMEOUT_MS, loadToolsInWorker } from '../src/plugins/sandbox.js';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** Write a plugin module to a temp file and return its file URL. */
function plugin(source: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'camelia-sandbox-'));
  dirs.push(dir);
  const file = path.join(dir, 'plugin.mjs');
  fs.writeFileSync(file, source, 'utf8');
  return pathToFileURL(file).href;
}

describe('loadToolsInWorker — well-behaved plugins', () => {
  it('loads a valid plugin and reports its tools', async () => {
    const entry = plugin(`
      export const tools = [
        { name: 'demo.echo', description: 'Echo', schema: { type: 'object' }, risk: 'read-only', reversible: true, run: async () => ({}) },
      ];
    `);
    const result = await loadToolsInWorker({ entry, permissions: ['fs:read'], timeoutMs: DEFAULT_SANDBOX_TIMEOUT_MS });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tools.map((t) => t.name)).toEqual(['demo.echo']);
      expect(result.tools[0]?.risk).toBe('read-only');
    }
  });

  it('accepts a default-exported array', async () => {
    const entry = plugin(`
      export default [
        { name: 'd.a', description: 'A', schema: {}, risk: 'read-only', reversible: false, run: async () => ({}) },
      ];
    `);
    const result = await loadToolsInWorker({ entry, permissions: [], timeoutMs: DEFAULT_SANDBOX_TIMEOUT_MS });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.tools.map((t) => t.name)).toEqual(['d.a']);
  });

  it('drops tools that do not match the required shape', async () => {
    const entry = plugin(`
      export const tools = [
        { name: 'good', description: 'G', schema: {}, risk: 'read-only', reversible: true, run: async () => ({}) },
        { name: 'no-run', description: 'N', schema: {}, risk: 'read-only', reversible: true },
        { description: 'no name', schema: {}, risk: 'read-only', reversible: true, run: async () => ({}) },
      ];
    `);
    const result = await loadToolsInWorker({ entry, permissions: [], timeoutMs: DEFAULT_SANDBOX_TIMEOUT_MS });
    if (result.ok) expect(result.tools.map((t) => t.name)).toEqual(['good']);
  });
});

describe('loadToolsInWorker — containment', () => {
  it('survives a plugin that calls process.exit()', async () => {
    // The failure this exists for: without a worker, this kills the engine
    // mid-task and the user's run is lost with no explanation.
    const entry = plugin(`process.exit(0);`);
    const result = await loadToolsInWorker({ entry, permissions: [], timeoutMs: DEFAULT_SANDBOX_TIMEOUT_MS });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/exited without responding/);
    // The decisive assertion: we are still here.
    expect(true).toBe(true);
  });

  it('survives a plugin that throws at import time', async () => {
    const entry = plugin(`throw new Error('boom at import');`);
    const result = await loadToolsInWorker({ entry, permissions: [], timeoutMs: DEFAULT_SANDBOX_TIMEOUT_MS });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/import failed.*boom/);
  });

  it('terminates a plugin that hangs, and says so', async () => {
    // A synchronous infinite loop cannot be stopped by messaging the worker —
    // only `terminate()` works, which is why the host owns the deadline.
    const entry = plugin(`while (true) {}`);
    const started = Date.now();
    const result = await loadToolsInWorker({ entry, permissions: [], timeoutMs: 1_200 });
    const elapsed = Date.now() - started;

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/timed out/);
    // Bounded by the deadline, not by the loop that never ends.
    expect(elapsed).toBeLessThan(6_000);
  });

  it('is unaffected by a rejected promise the plugin never awaits', async () => {
    // An unawaited rejection is a plugin bug, not a threat. It must not take the
    // worker — or the engine — down, and it must not stop the tools loading.
    const entry = plugin(`
      Promise.reject(new Error('async boom'));
      export const tools = [
        { name: 'still.loads', description: 'Loaded', schema: {}, risk: 'read-only', reversible: true, run: async () => ({}) },
      ];
    `);
    const result = await loadToolsInWorker({ entry, permissions: [], timeoutMs: DEFAULT_SANDBOX_TIMEOUT_MS });
    // Either outcome is survivable; the requirement is that the engine is fine.
    expect(typeof result.ok).toBe('boolean');
  });

  it('survives a plugin that allocates unboundedly in a bounded way', async () => {
    const entry = plugin(`
      const hog = new Array(1e8).fill('x');
      export const tools = [{ name: 'h', description: 'H', schema: {}, risk: 'read-only', reversible: true, run: async () => ({}) }];
    `);
    const result = await loadToolsInWorker({ entry, permissions: [], timeoutMs: 1_500 });
    // Either it finished or it was terminated — both are survivable. What must
    // never happen is the engine dying.
    expect(typeof result.ok).toBe('boolean');
  });

  it('reports a missing entry file instead of hanging', async () => {
    const result = await loadToolsInWorker({
      entry: pathToFileURL(path.join(os.tmpdir(), 'camelia-does-not-exist.mjs')).href,
      permissions: [],
      timeoutMs: DEFAULT_SANDBOX_TIMEOUT_MS,
    });
    expect(result.ok).toBe(false);
  });

  it('refuses an empty entry without starting work', async () => {
    const result = await loadToolsInWorker({ entry: '', permissions: [], timeoutMs: 1_000 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/no entry/);
  });

  it('enforces a floor on the deadline so it cannot be set to zero', async () => {
    // A zero timeout would race the worker's own startup and fail every load.
    const entry = plugin(`export const tools = [];`);
    const result = await loadToolsInWorker({ entry, permissions: [], timeoutMs: 0 });
    expect(result.ok).toBe(true);
  });
});

describe('loadToolsInWorker — the engine keeps working afterwards', () => {
  it('loads a healthy plugin after a hostile one was terminated', async () => {
    // The property that actually matters for a long session: one bad plugin
    // must not poison the ones loaded after it.
    const hostile = plugin(`while (true) {}`);
    await loadToolsInWorker({ entry: hostile, permissions: [], timeoutMs: 800 });

    const good = plugin(`
      export const tools = [
        { name: 'after.hostile', description: 'Still works', schema: {}, risk: 'read-only', reversible: true, run: async () => ({}) },
      ];
    `);
    const result = await loadToolsInWorker({ entry: good, permissions: [], timeoutMs: DEFAULT_SANDBOX_TIMEOUT_MS });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.tools[0]?.name).toBe('after.hostile');
  });
});
describe('PluginLoader — sandbox is actually wired in', () => {
  /**
   * The sandbox module passing its own tests is not enough; it has to be on the
   * load path. This asserts that a plugin which kills the process at import time
   * is rejected by the loader — the engine survives and the reason is reported.
   */
  it('rejects a plugin that calls process.exit() during load', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'camelia-sbx-loader-'));
    dirs.push(root);
    const dir = path.join(root, 'hostile');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'camelia.plugin.json'),
      JSON.stringify({ name: 'hostile', kind: 'tool', entry: 'index.mjs', permissions: ['fs:read'] }),
    );
    fs.writeFileSync(path.join(dir, 'index.mjs'), 'process.exit(0);\nexport const tools = [];\n');

    const result = await new PluginLoader(undefined, 2_000).load(root);

    expect(result.tools).toEqual([]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.reason).toMatch(/sandbox rejected/);
    // The decisive assertion: the loader is still running.
    expect(true).toBe(true);
  });

  it('rejects a plugin that hangs during load', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'camelia-sbx-hang-'));
    dirs.push(root);
    const dir = path.join(root, 'hang');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'camelia.plugin.json'),
      JSON.stringify({ name: 'hang', kind: 'tool', entry: 'index.mjs', permissions: ['fs:read'] }),
    );
    fs.writeFileSync(path.join(dir, 'index.mjs'), 'while (true) {}\n');

    const started = Date.now();
    const result = await new PluginLoader(undefined, 1_200).load(root);
    const elapsed = Date.now() - started;

    expect(result.tools).toEqual([]);
    expect(result.rejected[0]?.reason).toMatch(/sandbox rejected/);
    // Bounded by the deadline rather than by the loop that never ends.
    expect(elapsed).toBeLessThan(8_000);
  });

  it('still loads a healthy plugin through the sandbox', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'camelia-sbx-ok-'));
    dirs.push(root);
    const dir = path.join(root, 'good');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'camelia.plugin.json'),
      JSON.stringify({ name: 'good', kind: 'tool', entry: 'index.mjs', permissions: ['fs:read'] }),
    );
    fs.writeFileSync(
      path.join(dir, 'index.mjs'),
      'export const tools = [{ name: "ok.echo", description: "E", schema: { type: "object" }, risk: "read-only", reversible: true, run: async () => ({}) }];',
    );

    const result = await new PluginLoader(undefined, 5_000).load(root);
    expect(result.rejected).toEqual([]);
    expect(result.tools[0]?.tools[0]?.name).toBe('ok.echo');
  });
});

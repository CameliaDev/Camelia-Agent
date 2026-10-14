/**
 * Session reuse, rename, delete, and workspace switching on a real runtime.
 * @module
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { CameliaRuntime } from '../src/runtime/CameliaRuntime.js';
import type { ProviderHandle } from '../src/ProviderRegistry.js';
import { MockProvider } from '../src/providers/MockProvider.js';
import { installSkillFolder, listSkillDirs, skillScanRoots } from '../src/skills/skills.js';

const runtimes: CameliaRuntime[] = [];

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close().catch(() => undefined)));
  vi.unstubAllEnvs();
});

function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function boot(workspace: string): Promise<CameliaRuntime> {
  const home = tempDir('camelia-ses-home-');
  vi.stubEnv('CAMELIA_HOME', home);
  const handle: ProviderHandle = {
    id: 'mock',
    label: 'Mock',
    model: 'alpha',
    models: ['alpha'],
    port: new MockProvider({ id: 'mock', models: ['alpha'], script: [{ text: 'ok' }] }),
  };
  const runtime = await CameliaRuntime.create({
    workspace,
    providerHandles: [handle],
    model: 'alpha',
    databaseFile: ':memory:',
    planApproval: 'auto',
    logLevel: 'error',
    logTo: () => undefined,
  });
  runtimes.push(runtime);
  return runtime;
}

describe('session commands', () => {
  it('does not reuse a zero-event session titled hello', async () => {
    const workspace = tempDir('camelia-ses-ws-');
    const runtime = await boot(workspace);
    const hello = await runtime.store.createSession({
      title: 'hello',
      workspace,
      provider: 'mock',
      model: 'alpha',
      kind: 'work',
    });
    const created = await runtime.newSession('work');
    expect(created.sessionId).not.toBe(hello.id);
    const again = await runtime.newSession('work');
    expect(again.sessionId).toBe(created.sessionId);
  });

  it('renames and deletes, then points the runtime at a remaining session', async () => {
    const workspace = tempDir('camelia-ses-del-');
    const runtime = await boot(workspace);
    const renamed = await runtime.renameSession(runtime.session.id, 'kept');
    expect(renamed.ok).toBe(true);
    if (renamed.ok) expect(renamed.title).toBe('kept');
    const extra = await runtime.newSession('work');
    const removed = await runtime.deleteSession(extra.sessionId);
    expect(removed.ok).toBe(true);
    expect(await runtime.store.getSession(extra.sessionId)).toBeUndefined();
    expect(runtime.session.id).not.toBe(extra.sessionId);
  });

  it('set_workspace accepts a directory and refuses a file', async () => {
    const workspace = tempDir('camelia-ses-root-');
    const runtime = await boot(workspace);
    const next = tempDir('camelia-ses-next-');
    const ok = await runtime.setWorkspace(next);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.workspace).toBe(path.resolve(next));
    const file = path.join(workspace, 'file.txt');
    fs.writeFileSync(file, 'x');
    const bad = await runtime.setWorkspace(file);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toBe('not a directory');
  });
});

describe('skill folders', () => {
  it('lists and installs a SKILL.md directory', () => {
    const home = tempDir('camelia-skill-home-');
    vi.stubEnv('CAMELIA_HOME', home);
    const source = tempDir('camelia-skill-src-');
    const skillDir = path.join(source, 'greet');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: greet\ndescription: Say hello\n---\n# Greet\n',
    );
    const installed = installSkillFolder(skillDir);
    expect(installed.ok).toBe(true);
    const listed = listSkillDirs(skillScanRoots());
    expect(listed.some((skill) => skill.name === 'greet' && skill.description === 'Say hello')).toBe(true);
    const missing = installSkillFolder(source);
    expect(missing.ok).toBe(true);
  });
});

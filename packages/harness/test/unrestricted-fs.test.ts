/**
 * Chat policy FULL unlocks whole-machine fs paths.
 * @module
 */
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

import { fsReadTool } from '../src/tools/builtin/fs-tools.js';
import type { ToolContext } from '../src/tools/types.js';

function mockCtx(over: Pick<ToolContext, 'workspace' | 'unrestrictedFs'> & Partial<ToolContext>): ToolContext {
  return {
    extraAllowPaths: over.extraAllowPaths,
    fs: {
      async readFile(p: string) {
        return fs.promises.readFile(p, 'utf8');
      },
      async writeFile() {},
      async exists(p: string) {
        try {
          await fs.promises.access(p);
          return true;
        } catch {
          return false;
        }
      },
      async stat(filePath: string) {
        return { path: filePath, isFile: true, isDirectory: false, isDir: false, size: 1, mtimeMs: 0 };
      },
      async list() {
        return [];
      },
      async mkdir() {},
      async mkdirp() {},
      async remove() {},
      async copy() {},
      async hash() {
        return '0'.repeat(64);
      },
    } as unknown as ToolContext['fs'],
    shell: {
      exec: async () => ({ code: 0, stdout: '', stderr: '', durationMs: 0, timedOut: false, truncated: false }),
    },
    search: { glob: async () => [], grep: async () => [] },
    logger: {
      debug() {},
      info() {},
      warn() {},
      error() {},
      log() {},
      child() {
        return this;
      },
    } as ToolContext['logger'],
    clock: { now: () => Date.now(), sleep: async () => {} },
    journal: { size: 0, record() {}, restore: async () => {} } as unknown as ToolContext['journal'],
    signal: new AbortController().signal,
    workspace: over.workspace,
    unrestrictedFs: over.unrestrictedFs,
  };
}

describe('unrestrictedFs', () => {
  it('allows absolute paths outside workspace when unrestrictedFs is true', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'camelia-full-'));
    const file = path.join(dir, 'outside.txt');
    fs.writeFileSync(file, 'hello-full\n', 'utf8');
    const workspace = path.join(dir, 'ws');
    fs.mkdirSync(workspace);
    const ctx = mockCtx({ workspace, unrestrictedFs: true });
    const result = (await fsReadTool.run({ path: file }, ctx)) as { content: string };
    expect(result.content).toContain('hello-full');
  });

  it('still denies outside paths when unrestrictedFs is false', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'camelia-sand-'));
    const file = path.join(dir, 'secret.txt');
    fs.writeFileSync(file, 'nope\n', 'utf8');
    const workspace = path.join(dir, 'ws');
    fs.mkdirSync(workspace);
    const ctx = mockCtx({ workspace, unrestrictedFs: false });
    await expect(fsReadTool.run({ path: file }, ctx)).rejects.toThrow(/allowed roots|escapes|sandbox/i);
  });
});

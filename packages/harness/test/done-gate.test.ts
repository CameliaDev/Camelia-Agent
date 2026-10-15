/**
 * Done gate — blocks completion on red verification, skips clean trees when configured.
 * @module
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { WorkspaceJournal } from '../src/checkpoint/WorkspaceJournal.js';
import { detectProjectCommands, doneGateFailurePrompt, runDoneGate } from '../src/verification/done-gate.js';
import { FakeFs } from './helpers/fake-fs.js';

function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('detectProjectCommands', () => {
  it('reads test and typecheck scripts from package.json', () => {
    const workspace = tempDir('done-gate-pkg-');
    fs.writeFileSync(
      path.join(workspace, 'package.json'),
      JSON.stringify({ scripts: { test: 'vitest run', typecheck: 'tsc -p tsconfig.json' } }),
    );
    expect(detectProjectCommands(workspace)).toEqual({
      test: 'npm test',
      typecheck: 'npm run typecheck',
    });
  });
});

describe('runDoneGate', () => {
  it('skips when onlyWhenDirty and the journal is empty', async () => {
    const workspace = tempDir('done-gate-clean-');
    fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "process.exit(1)"' } }));
    const journal = new WorkspaceJournal('/tmp', 't1', new FakeFs(), undefined);
    const shell = { exec: async () => ({ code: 1, stdout: '', stderr: 'boom', durationMs: 1, timedOut: false, truncated: false }) };
    const result = await runDoneGate({ workspace, shell, journal, config: { onlyWhenDirty: true } });
    expect(result.skipped).toBe(true);
    expect(result.ok).toBe(true);
  });

  it('blocks when verification exits non-zero after edits', async () => {
    const workspace = tempDir('done-gate-red-');
    fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "process.exit(2)"' } }));
    const fsPort = new FakeFs();
    const journal = new WorkspaceJournal('/tmp', 't2', fsPort, undefined);
    await journal.record(path.join(workspace, 'a.ts'), 'a.ts');
    let ran = false;
    const shell = {
      exec: async () => {
        ran = true;
        return { code: 2, stdout: '', stderr: 'tests failed', durationMs: 1, timedOut: false, truncated: false };
      },
    };
    const result = await runDoneGate({ workspace, shell, journal, config: { testCommand: 'pnpm test' } });
    expect(ran).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(doneGateFailurePrompt(result)).toContain('tests failed');
  });

  it('allows completion when verification passes', async () => {
    const workspace = tempDir('done-gate-green-');
    const journal = new WorkspaceJournal('/tmp', 't3', new FakeFs(), undefined);
    await journal.record(path.join(workspace, 'b.ts'), 'b.ts');
    const shell = {
      exec: async () => ({ code: 0, stdout: 'ok', stderr: '', durationMs: 1, timedOut: false, truncated: false }),
    };
    const result = await runDoneGate({ workspace, shell, journal, config: { testCommand: 'pnpm test' } });
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(false);
  });
});

import { mkdtemp, rm } from 'node:fs/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { appendAbiMismatch, isAbiMismatchError, migrateAbiMismatch } from '../src/runtime/abi.js';

/**
 * Iteration 24 — abi-mismatch failure mode.
 *
 * The store cannot open at all when the native binary targets a different Node
 * ABI, so the record goes to a sidecar log and is migrated into `failure_modes`
 * on the next successful start — that is when the planner can read it.
 */
describe('abi-mismatch detection', () => {
  it('recognises native-module ABI errors', () => {
    expect(
      isAbiMismatchError(
        new Error("The module '...better_sqlite3.node' was compiled against a different Node.js version using NODE_MODULE_VERSION 137."),
      ),
    ).toBe(true);
    expect(isAbiMismatchError(new Error('ENOENT: no such file'))).toBe(false);
  });

  it('appends an out-of-band sidecar row when the store cannot open', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'camelia-abi-'));
    try {
      appendAbiMismatch(path.join(dir, 'logs'), 'C:/ws', new Error('was compiled against a different Node.js version'));
      const lines = fs
        .readFileSync(path.join(dir, 'logs', 'abi-mismatch.jsonl'), 'utf8')
        .trim()
        .split(/\r?\n/);
      expect(lines).toHaveLength(1);
      const row = JSON.parse(lines[0]!) as { workspace: string; mechanism: string };
      expect(row.workspace).toBe('C:/ws');
      expect(row.mechanism).toContain('abi-mismatch');
      expect(row.mechanism).not.toContain('You should');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('migrates sidecar rows into failure_modes once the store is usable, then drops the sidecar', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'camelia-abi-'));
    try {
      appendAbiMismatch(path.join(dir, 'logs'), 'C:/ws', new Error('was compiled against a different Node.js version'));
      const rows: Array<{ kind: string; mechanism: string; workspace: string }> = [];
      const store = {
        async recordFailureMode(input: { kind: string; mechanism: string; workspace: string }): Promise<void> {
          rows.push(input);
        },
        async countFailureModes(_workspace: string, kind?: string): Promise<number> {
          return rows.filter((r) => kind === undefined || r.kind === kind).length;
        },
      };

      await migrateAbiMismatch(store, path.join(dir, 'logs'), 'C:/ws');
      expect(rows).toHaveLength(1);
      expect(rows[0]?.kind).toBe('abi-mismatch');
      expect(rows[0]?.mechanism).toContain('native module load failed');
      expect(fs.existsSync(path.join(dir, 'logs', 'abi-mismatch.jsonl'))).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('migrates only rows for the current workspace', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'camelia-abi-'));
    try {
      appendAbiMismatch(path.join(dir, 'logs'), 'C:/other-ws', new Error('was compiled against a different Node.js version'));
      const rows: Array<{ kind: string; mechanism: string; workspace: string }> = [];
      const store = {
        async recordFailureMode(input: { kind: string; mechanism: string; workspace: string }): Promise<void> {
          rows.push(input);
        },
        async countFailureModes(): Promise<number> {
          return rows.length;
        },
      };

      await migrateAbiMismatch(store, path.join(dir, 'logs'), 'C:/ws');
      expect(rows).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('append never throws when the log location is unusable', () => {
    // logsDir points at a regular file — mkdirSync fails; the boot-time sidecar
    // write must stay silent so the original store error survives.
    const dir = path.join(os.tmpdir(), 'camelia-abi-notadir');
    try {
      fs.writeFileSync(dir, 'not-a-dir');
      expect(() => appendAbiMismatch(dir, 'C:/ws', new Error('x'))).not.toThrow();
    } finally {
      fs.rmSync(dir, { force: true });
    }
  });

  it('migrates past malformed sidecar lines and tolerates store write failures', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'camelia-abi-'));
    try {
      const logsDir = path.join(dir, 'logs');
      fs.mkdirSync(logsDir, { recursive: true });
      // One malformed line (skipped), one good line.
      fs.writeFileSync(
        path.join(logsDir, 'abi-mismatch.jsonl'),
        'this-is-not-json\n' + JSON.stringify({ ts: 1, workspace: 'C:/ws', mechanism: 'abi-mismatch: boom' }) + '\n',
        'utf8',
      );
      let calls = 0;
      const store = {
        async recordFailureMode(): Promise<void> {
          calls += 1;
          throw new Error('store write failed');
        },
      };
      // Must not throw despite the store rejection.
      await migrateAbiMismatch(store, logsDir, 'C:/ws');
      expect(calls).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

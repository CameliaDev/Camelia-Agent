/**
 * Workspace journal — the foundation of "误操作可回滚率 100%" (metric M6).
 *
 * Before a tool mutates a file for the first time in a task, its original content
 * is copied into a backup directory outside the workspace. Rolling back restores
 * exactly those bytes; files that did not exist before are deleted again.
 * @module
 */

import path from 'node:path';

import type { FsPort, LoggerPort } from '@camelia/core';

export interface JournalEntry {
  /** Absolute path of the mutated file. */
  path: string;
  /** Workspace-relative posix path. */
  relPath: string;
  /** Whether the file existed before the task touched it. */
  existed: boolean;
  /** Absolute path of the backup copy, when the file existed. */
  backupPath?: string;
}

export class WorkspaceJournal {
  private readonly entries = new Map<string, JournalEntry>();

  constructor(
    private readonly backupRoot: string,
    private readonly taskId: string,
    private readonly fs: FsPort,
    private readonly logger?: LoggerPort,
  ) {}

  /** Record the pre-mutation state of `absPath`. Idempotent per path. */
  async record(absPath: string, relPath: string): Promise<void> {
    if (this.entries.has(absPath)) return;

    const existed = await this.fs.exists(absPath);
    if (!existed) {
      this.entries.set(absPath, { path: absPath, relPath, existed: false });
      this.logger?.debug('journal: recording new file', { relPath });
      return;
    }

    const content = await this.fs.readFile(absPath);
    const dir = path.join(this.backupRoot, this.taskId);
    const backupPath = path.join(dir, `${this.entries.size}-${path.basename(relPath)}`);
    await this.fs.mkdir(dir);
    await this.fs.writeFile(backupPath, content);
    this.entries.set(absPath, { path: absPath, relPath, existed: true, backupPath });
    this.logger?.debug('journal: recorded existing file', { relPath, backupPath });
  }

  /** Files touched so far. */
  list(): JournalEntry[] {
    return [...this.entries.values()];
  }

  get size(): number {
    return this.entries.size;
  }

  /** Restore every recorded file to its pre-task state. Returns the number restored. */
  async rollback(): Promise<number> {
    let restored = 0;
    // Reverse order so the most recent mutation is undone first.
    for (const entry of [...this.entries.values()].reverse()) {
      try {
        if (entry.existed && entry.backupPath) {
          const content = await this.fs.readFile(entry.backupPath);
          await this.fs.writeFile(entry.path, content);
        } else {
          await this.fs.remove(entry.path);
        }
        restored += 1;
      } catch (error) {
        this.logger?.warn('journal: rollback failed for a file', {
          relPath: entry.relPath,
          error: String(error),
        });
      }
    }
    this.entries.clear();
    return restored;
  }

  /** Drop the journal (backups are left for forensics but no longer tracked). */
  clear(): void {
    this.entries.clear();
  }
}
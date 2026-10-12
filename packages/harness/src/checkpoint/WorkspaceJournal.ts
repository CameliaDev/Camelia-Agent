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
  /** Named markers (checkpoint ids) → the entries.size at the moment of marking. */
  private readonly marks = new Map<string, number>();

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

  /** Tag the current journal depth with a checkpoint id. */
  mark(name: string): void {
    this.marks.set(name, this.entries.size);
  }

  /** Restore every recorded file to its pre-task state. Returns the number restored. */
  async rollback(): Promise<number> {
    return this.restoreFrom(0);
  }

  /**
   * Restore only the files touched *after* the named marker was set.
   * If the marker is unknown, restores everything (safe fallback).
   */
  async rollbackTo(marker: string): Promise<number> {
    const from = this.marks.get(marker) ?? 0;
    return this.restoreFrom(from);
  }

  private async restoreFrom(fromIndex: number): Promise<number> {
    const all = [...this.entries.values()];
    let restored = 0;
    // Reverse order so the most recent mutation is undone first.
    for (let i = all.length - 1; i >= fromIndex; i -= 1) {
      const entry = all[i]!;
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
    // Drop entries at and after the rolled-back boundary; keep earlier ones.
    const kept = all.slice(0, fromIndex);
    this.entries.clear();
    for (const entry of kept) this.entries.set(entry.path, entry);
    return restored;
  }

  /** Drop the journal (backups are left for forensics but no longer tracked). */
  clear(): void {
    this.entries.clear();
    this.marks.clear();
  }
}
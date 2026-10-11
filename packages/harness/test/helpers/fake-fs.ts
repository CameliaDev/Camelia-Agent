/**
 * In-memory `FsPort` for harness tests.
 *
 * The harness is tested against ports, never against Node's filesystem: that is
 * the whole point of the port boundary (whitepaper §2.2). Using a fake also makes
 * rollback and checkpoint tests deterministic and free of temp-dir cleanup.
 * @module
 */

import { createHash } from 'node:crypto';

import type { DirEntry, FileStat, FsPort, ListOptions } from '@camelia/core';

export class FakeFs implements FsPort {
  readonly files = new Map<string, string>();
  readonly dirs = new Set<string>();

  constructor(seed: Record<string, string> = {}) {
    for (const [path, content] of Object.entries(seed)) this.files.set(normalise(path), content);
  }

  async readFile(path: string): Promise<string> {
    const content = this.files.get(normalise(path));
    if (content === undefined) throw new Error(`ENOENT: no such file, open '${path}'`);
    return content;
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(normalise(path), content);
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(normalise(path)) || this.dirs.has(normalise(path));
  }

  async stat(path: string): Promise<FileStat> {
    const key = normalise(path);
    const content = this.files.get(key);
    if (content === undefined) throw new Error(`ENOENT: no such file, stat '${path}'`);
    return { path: key, size: Buffer.byteLength(content, 'utf8'), mtimeMs: 0, isFile: true, isDir: false };
  }

  async mkdir(path: string): Promise<void> {
    this.dirs.add(normalise(path));
  }

  async remove(path: string): Promise<void> {
    const key = normalise(path);
    this.files.delete(key);
    this.dirs.delete(key);
    for (const file of [...this.files.keys()]) {
      if (file.startsWith(`${key}/`)) this.files.delete(file);
    }
  }

  async hash(path: string): Promise<string> {
    const content = this.files.get(normalise(path)) ?? '';
    return createHash('sha256').update(content).digest('hex').slice(0, 16);
  }

  async list(dir: string, options: ListOptions = {}): Promise<DirEntry[]> {
    const base = normalise(dir);
    const prefix = base === '' ? '' : `${base}/`;
    const ignore = new Set(options.ignore ?? []);
    const out: DirEntry[] = [];
    for (const [path, content] of this.files) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      if (rest.includes('/') && options.recursive === false) continue;
      if (rest.split('/').some((segment) => ignore.has(segment))) continue;
      out.push({ name: rest, path, type: 'file', size: Buffer.byteLength(content, 'utf8') });
      if (options.maxEntries && out.length >= options.maxEntries) break;
    }
    return out;
  }
}

/** Normalise a path to forward slashes, collapsing `.` segments. */
export function normalise(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');
}
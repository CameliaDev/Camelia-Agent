/**
 * Node filesystem adapter for the `FsPort` contract.
 *
 * The adapter is rooted at a workspace so that every `DirEntry.path` it returns is
 * workspace-relative — the model must never see an absolute path it could then
 * try to escape from (whitepaper §3.8).
 * @module
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { decodeBytes, type DirEntry, type FileStat, type FsPort, type ListOptions } from '@camelia/core';
import { toPosix } from '@camelia/core';

const DEFAULT_MAX_ENTRIES = 2_000;

export class NodeFs implements FsPort {
  constructor(private root: string) {}

  /** Re-root after the user picks another working folder. */
  setRoot(root: string): void {
    this.root = root;
  }

  async readFile(filePath: string): Promise<string> {
    const buf = await fs.readFile(filePath);
    return decodeBytes(buf);
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    await fs.writeFile(filePath, content, 'utf8');
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async stat(filePath: string): Promise<FileStat> {
    const s = await fs.stat(filePath);
    return {
      path: toPosix(path.relative(this.root, filePath)),
      size: s.size,
      mtimeMs: s.mtimeMs,
      isFile: s.isFile(),
      isDir: s.isDirectory(),
    };
  }

  async mkdir(dirPath: string): Promise<void> {
    await fs.mkdir(dirPath, { recursive: true });
  }

  async remove(filePath: string): Promise<void> {
    await fs.rm(filePath, { force: true, recursive: true });
  }

  async hash(filePath: string): Promise<string> {
    const buffer = await fs.readFile(filePath);
    return createHash('sha256').update(buffer).digest('hex').slice(0, 16);
  }

  async list(dir: string, options: ListOptions = {}): Promise<DirEntry[]> {
    const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    const ignore = new Set(options.ignore ?? []);
    const results: DirEntry[] = [];

    const walk = async (current: string, depth: number): Promise<void> => {
      if (results.length >= maxEntries) return;
      let dirents;
      try {
        dirents = await fs.readdir(current, { withFileTypes: true });
      } catch {
        return;
      }
      for (const dirent of dirents) {
        if (results.length >= maxEntries) return;
        if (ignore.has(dirent.name)) continue;
        const abs = path.join(current, dirent.name);
        const rel = toPosix(path.relative(this.root, abs));
        if (dirent.isDirectory()) {
          results.push({ name: dirent.name, path: rel, type: 'dir' });
          if (options.recursive !== false && depth < 12) await walk(abs, depth + 1);
        } else if (dirent.isSymbolicLink()) {
          results.push({ name: dirent.name, path: rel, type: 'symlink' });
        } else if (dirent.isFile()) {
          let size: number | undefined;
          try {
            size = (await fs.stat(abs)).size;
          } catch {
            size = undefined;
          }
          results.push({ name: dirent.name, path: rel, type: 'file', size });
        }
      }
    };

    await walk(dir, 0);
    return results;
  }
}
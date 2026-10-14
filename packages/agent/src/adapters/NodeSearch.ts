/**
 * Node search adapter for the `SearchPort` contract.
 *
 * Implements glob and grep without any dependency: deterministic file location is
 * a *substitute for model capability*, not something we outsource
 * (whitepaper §5.5).
 * @module
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import type { GlobOptions, GrepMatch, GrepOptions, SearchPort } from '@camelia/core';
import { toPosix } from '@camelia/core';

const DEFAULT_IGNORE = ['node_modules', '.git', 'dist', 'coverage', '.turbo', 'target'];
const MAX_FILES_SCANNED = 20_000;
const MAX_FILE_BYTES = 2_000_000;

/** Translate a glob into a regular expression. Supports `**`, `*`, `?`, `{a,b}`. */
export function globToRegExp(pattern: string): RegExp {
  const normalised = toPosix(pattern);
  let out = '^';
  let i = 0;
  while (i < normalised.length) {
    const ch = normalised[i]!;
    if (ch === '*') {
      if (normalised[i + 1] === '*') {
        // `**/` matches zero or more path segments; a trailing `**` matches all.
        if (normalised[i + 2] === '/') {
          out += '(?:.*/)?';
          i += 3;
        } else {
          out += '.*';
          i += 2;
        }
        continue;
      }
      out += '[^/]*';
      i += 1;
      continue;
    }
    if (ch === '?') {
      out += '[^/]';
      i += 1;
      continue;
    }
    if (ch === '{') {
      const close = normalised.indexOf('}', i);
      if (close !== -1) {
        const options = normalised.slice(i + 1, close).split(',');
        out += `(?:${options.map(escapeRegExp).join('|')})`;
        i = close + 1;
        continue;
      }
    }
    out += escapeRegExp(ch);
    i += 1;
  }
  out += '$';
  return new RegExp(out);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

export class NodeSearch implements SearchPort {
  constructor(private root: string) {}

  /** Re-root after the user picks another working folder. */
  setRoot(root: string): void {
    this.root = root;
  }

  async glob(pattern: string, options: GlobOptions = {}): Promise<string[]> {
    const base = options.cwd ?? this.root;
    const ignore = new Set(options.ignore ?? DEFAULT_IGNORE);
    const max = options.maxResults ?? 200;
    const matcher = globToRegExp(pattern);
    const results: string[] = [];

    await this.walkFiles(base, ignore, async (abs, rel) => {
      if (results.length >= max) return false;
      if (matcher.test(rel)) results.push(rel);
      return true;
    });
    return results;
  }

  async grep(pattern: string, options: GrepOptions = {}): Promise<GrepMatch[]> {
    const base = options.cwd ?? this.root;
    const ignore = new Set(options.ignore ?? DEFAULT_IGNORE);
    const max = options.maxResults ?? 100;
    const maxPerFile = options.maxPerFile ?? 20;
    const flags = options.ignoreCase ? 'gi' : 'g';

    let matcher: RegExp;
    try {
      matcher = new RegExp(pattern, flags);
    } catch {
      matcher = new RegExp(escapeRegExp(pattern), flags);
    }

    const globMatcher = options.glob ? globToRegExp(options.glob) : undefined;
    const results: GrepMatch[] = [];

    await this.walkFiles(base, ignore, async (abs, rel) => {
      if (results.length >= max) return false;
      if (globMatcher && !globMatcher.test(rel)) return true;
      let content: string;
      try {
        const stat = await fs.stat(abs);
        if (stat.size > MAX_FILE_BYTES) return true;
        content = await fs.readFile(abs, 'utf8');
      } catch {
        return true;
      }
      if (content.includes('\u0000')) return true; // binary

      const lines = content.split('\n');
      let perFile = 0;
      for (let lineIdx = 0; lineIdx < lines.length && perFile < maxPerFile; lineIdx += 1) {
        const line = lines[lineIdx]!;
        matcher.lastIndex = 0;
        const match = matcher.exec(line);
        if (!match) continue;
        results.push({
          path: rel,
          line: lineIdx + 1,
          column: match.index + 1,
          text: line.trim().slice(0, 240),
        });
        perFile += 1;
        if (results.length >= max) break;
      }
      return true;
    });

    return results;
  }

  /** Walk files under `base`, invoking `visit(abs, rel)`. Stop when it returns false. */
  private async walkFiles(
    base: string,
    ignore: Set<string>,
    visit: (abs: string, rel: string) => Promise<boolean>,
  ): Promise<void> {
    let scanned = 0;
    const stack: string[] = [base];
    while (stack.length > 0) {
      const current = stack.pop()!;
      let dirents;
      try {
        dirents = await fs.readdir(current, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const dirent of dirents) {
        if (ignore.has(dirent.name)) continue;
        const abs = path.join(current, dirent.name);
        if (dirent.isDirectory()) {
          stack.push(abs);
          continue;
        }
        if (!dirent.isFile()) continue;
        scanned += 1;
        if (scanned > MAX_FILES_SCANNED) return;
        const rel = toPosix(path.relative(this.root, abs));
        const keepGoing = await visit(abs, rel);
        if (!keepGoing) return;
      }
    }
  }
}
/**
 * Path helpers. Workspace containment is a security boundary (whitepaper §3.8):
 * tools must never escape the workspace root.
 * @module
 */

import path from 'node:path';

/** Normalize to forward slashes so hashes/keys are stable across platforms. */
export function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

/** Resolve `target` against `root` and return a workspace-relative posix path. */
export function relativeTo(root: string, target: string): string {
  return toPosix(path.relative(root, path.resolve(root, target)));
}

/**
 * True when `target` resolves inside `root`.
 * Rejects both `..` escapes and absolute paths outside the root.
 */
export function isWithin(root: string, target: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(root, target);
  const rel = path.relative(resolvedRoot, resolvedTarget);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Throwing guard for tool implementations. */
export function assertWithin(root: string, target: string): string {
  if (!isWithin(root, target)) {
    throw new Error(`Path escapes workspace: ${target} is outside ${root}`);
  }
  return path.resolve(root, target);
}

/** Basename without extension. */
export function stem(p: string): string {
  const base = path.basename(p);
  const ext = path.extname(base);
  return ext ? base.slice(0, -ext.length) : base;
}
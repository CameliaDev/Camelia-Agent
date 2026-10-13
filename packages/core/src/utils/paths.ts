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

/**
 * A Windows drive path (`C:/...`) running on POSIX.
 *
 * `path.resolve` treats that string as relative and prefixes the cwd, so a
 * workspace of `C:/workspace` and a lookup of `C:/workspace/a.txt` stop being
 * the same file. Drive roots stay on `path.win32` and come back as posix.
 */
function isForeignWinRoot(root: string): boolean {
  return process.platform !== 'win32' && /^[A-Za-z]:\//.test(toPosix(root));
}

function resolveAgainst(root: string, target: string): string {
  if (!isForeignWinRoot(root)) return path.resolve(root, target);
  return toPosix(path.win32.resolve(toPosix(root), toPosix(target)));
}

/** Resolve `target` against `root` and return a workspace-relative posix path. */
export function relativeTo(root: string, target: string): string {
  if (isForeignWinRoot(root)) {
    const absRoot = toPosix(path.win32.resolve(toPosix(root)));
    return toPosix(path.win32.relative(absRoot, resolveAgainst(root, target)));
  }
  return toPosix(path.relative(root, path.resolve(root, target)));
}

/**
 * True when `target` resolves inside `root`.
 * Rejects both `..` escapes and absolute paths outside the root.
 */
export function isWithin(root: string, target: string): boolean {
  if (isForeignWinRoot(root)) {
    const resolvedRoot = toPosix(path.win32.resolve(toPosix(root)));
    const resolvedTarget = resolveAgainst(root, target);
    const rel = toPosix(path.win32.relative(resolvedRoot, resolvedTarget));
    return rel === '' || (!rel.startsWith('..') && !path.win32.isAbsolute(rel));
  }
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
  return resolveAgainst(root, target);
}

/** Basename without extension. */
export function stem(p: string): string {
  const base = path.basename(p);
  const ext = path.extname(base);
  return ext ? base.slice(0, -ext.length) : base;
}
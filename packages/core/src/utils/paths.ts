/**
 * Path helpers. Workspace containment is a security boundary (whitepaper §3.8):
 * tools must never escape the allowed roots (primary workspace plus optional
 * extraAllowPaths). Permission mode FULL skips approval prompts only — it does
 * not expand this list.
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

/** True when `target` looks absolute on this host or as a foreign Windows drive. */
export function looksAbsolute(target: string): boolean {
  const posix = toPosix(target);
  if (/^[A-Za-z]:\//.test(posix)) return true;
  if (posix.startsWith('/')) return true;
  return path.isAbsolute(target);
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

function resolveRootAbsolute(root: string): string {
  const posix = toPosix(root.trim());
  if (!posix) return posix;
  if (isForeignWinRoot(posix) || /^[A-Za-z]:\//.test(posix)) {
    return toPosix(path.win32.resolve(posix));
  }
  return path.resolve(posix);
}

/**
 * Deduped absolute roots: primary workspace first, then any extraAllowPaths.
 * Empty / whitespace entries are dropped.
 */
export function normalizeAllowRoots(
  workspace: string,
  extraAllowPaths: readonly string[] = [],
): string[] {
  const roots: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string): void => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    const resolved = resolveRootAbsolute(trimmed);
    if (!resolved) return;
    const key = toPosix(resolved).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    roots.push(resolved);
  };
  add(workspace);
  for (const extra of extraAllowPaths) add(extra);
  return roots;
}

/**
 * Relative targets resolve against the primary workspace, then must land in
 * some allow root. Absolute targets are checked against each root in turn.
 */
export function resolveInAllowRoots(
  workspace: string,
  target: string,
  extraAllowPaths: readonly string[] = [],
): { abs: string; root: string } | undefined {
  const roots = normalizeAllowRoots(workspace, extraAllowPaths);
  const primary = roots[0];
  if (!primary) return undefined;

  if (looksAbsolute(target)) {
    for (const root of roots) {
      if (isWithin(root, target)) {
        return { abs: resolveAgainst(root, target), root };
      }
    }
    return undefined;
  }

  const abs = resolveAgainst(primary, target);
  for (const root of roots) {
    if (isWithin(root, abs)) {
      return { abs, root };
    }
  }
  return undefined;
}

/** True when `target` resolves inside the primary workspace or an extra allow root. */
export function isWithinAllowRoots(
  workspace: string,
  target: string,
  extraAllowPaths: readonly string[] = [],
): boolean {
  return resolveInAllowRoots(workspace, target, extraAllowPaths) !== undefined;
}

function allowRootsDenialMessage(target: string, roots: readonly string[]): string {
  const listed = roots.map((r) => toPosix(r)).join(', ') || '(none)';
  return (
    `Path escapes allowed roots: ${target} is outside [${listed}]. ` +
    `Permission mode FULL only skips approval prompts — it does not expand the sandbox. ` +
    `Add absolute directories to extraAllowPaths in ~/.camelia/config.json ` +
    `(or HarnessConfig.extraAllowPaths) to permit more roots.`
  );
}

/**
 * Resolve `target` under the primary workspace or configured extraAllowPaths.
 * Throws with guidance when the path is outside every allow root.
 */
export function assertWithinAllowRoots(
  workspace: string,
  target: string,
  extraAllowPaths: readonly string[] = [],
): string {
  const hit = resolveInAllowRoots(workspace, target, extraAllowPaths);
  if (!hit) {
    throw new Error(allowRootsDenialMessage(target, normalizeAllowRoots(workspace, extraAllowPaths)));
  }
  return hit.abs;
}

/**
 * Display path for tool results: workspace-relative when inside the primary
 * root, otherwise an absolute posix path under an extra allow root.
 */
export function displayPathForAllowRoots(
  workspace: string,
  abs: string,
  extraAllowPaths: readonly string[] = [],
): string {
  if (isWithin(workspace, abs)) return relativeTo(workspace, abs) || '.';
  const roots = normalizeAllowRoots(workspace, extraAllowPaths);
  for (const root of roots) {
    if (toPosix(resolveRootAbsolute(workspace)).toLowerCase() === toPosix(root).toLowerCase()) continue;
    if (isWithin(root, abs)) {
      const rel = relativeTo(root, abs);
      return rel ? `${toPosix(root)}/${rel}` : toPosix(root);
    }
  }
  return toPosix(abs);
}

/** Throwing guard for tool implementations (primary workspace only). */
export function assertWithin(root: string, target: string): string {
  if (!isWithin(root, target)) {
    throw new Error(
      `Path escapes workspace: ${target} is outside ${root}. ` +
        `Permission mode FULL only skips approval prompts — it does not expand the sandbox. ` +
        `Add absolute directories to extraAllowPaths in ~/.camelia/config.json to permit more roots.`,
    );
  }
  return resolveAgainst(root, target);
}

/** Basename without extension. */
export function stem(p: string): string {
  const base = path.basename(p);
  const ext = path.extname(base);
  return ext ? base.slice(0, -ext.length) : base;
}

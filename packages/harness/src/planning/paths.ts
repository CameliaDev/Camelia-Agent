/**
 * Workspace path enum.
 *
 * The model may describe the goal. It may not invent the path set. The set is
 * the file listing, plus a parent directory or a named new file only when the
 * request is to add a file and that parent already exists.
 * @module
 */

import type { FsPort, Plan } from '@camelia/core';

const FILE_MENTION = /\b[\w./\\-]+\.(?:ts|tsx|js|jsx|json|md|py|rs|go|java|c|cpp|h)\b/g;
const ADD_INTENT = /\b(add|create|write|new|implement|introduce)\b/i;

export class PathEnumError extends Error {
  readonly rejected: string[];
  readonly allowed: string[];

  constructor(rejected: string[], allowed: string[]) {
    super(`Rejected path ${rejected.join(', ')}. Allowed: ${allowed.join(', ') || '(none)'}`);
    this.name = 'PathEnumError';
    this.rejected = rejected;
    this.allowed = allowed;
  }
}

export function relativeTo(workspace: string, path: string): string {
  const base = workspace.replace(/\\/g, '/').replace(/\/$/, '');
  const file = path.replace(/\\/g, '/');
  if (file === base) return '.';
  if (file.startsWith(`${base}/`)) return file.slice(base.length + 1);
  return file.replace(/^\.\//, '');
}

function parentOf(path: string): string {
  const normalised = path.replace(/\\/g, '/').replace(/^\.\//, '');
  const slash = normalised.lastIndexOf('/');
  return slash <= 0 ? '.' : normalised.slice(0, slash);
}

export function wantsNewFile(rawIntent: string, existingFileCount = 0): boolean {
  if (ADD_INTENT.test(rawIntent)) return true;
  // An empty workspace has no file to edit. The task is adding one.
  return existingFileCount === 0 && rawIntent.trim().length > 0;
}

/** Files from `fs.list`, plus parents and named new files when the request adds a file. */
export function allowedPathEnum(
  entries: { path: string; type: string }[],
  workspace: string,
  rawIntent: string,
): string[] {
  const files = entries.filter((entry) => entry.type === 'file').map((entry) => relativeTo(workspace, entry.path));
  const adding = wantsNewFile(rawIntent, files.length);
  const dirs = new Set<string>(['.']);
  for (const entry of entries) {
    if (entry.type === 'dir') dirs.add(relativeTo(workspace, entry.path));
  }
  for (const file of files) dirs.add(parentOf(file));

  const allowed = new Set(files);
  if (adding) {
    for (const dir of dirs) allowed.add(dir);
    for (const match of rawIntent.match(FILE_MENTION) ?? []) {
      const path = match.replace(/\\/g, '/').replace(/^\.\//, '');
      if (dirs.has(parentOf(path))) allowed.add(path);
    }
  }
  return [...allowed].sort();
}

export async function listWorkspaceEntries(
  fs: FsPort,
  workspace: string,
): Promise<{ path: string; type: string }[]> {
  try {
    return await fs.list(workspace, {
      recursive: true,
      maxEntries: 400,
      ignore: ['node_modules', '.git', 'dist', 'coverage', '.turbo', 'target', '.next'],
    });
  } catch {
    return [];
  }
}

function escapesWorkspace(path: string): boolean {
  return path === '..' || path.startsWith('../') || path.includes('/../');
}

/** A path is on the enum, or it sits under an allowed directory and does not escape. */
function coveredByEnum(path: string, permit: Set<string>): boolean {
  if (permit.has(path)) return true;
  if (escapesWorkspace(path)) return false;
  let parent = parentOf(path);
  const seen = new Set<string>();
  while (!seen.has(parent)) {
    if (permit.has(parent)) return true;
    seen.add(parent);
    if (parent === '.') break;
    parent = parentOf(parent);
  }
  return false;
}

/** Acceptance paths that are not members of the enum. Command checks are not paths. */
export function pathViolations(plan: Plan, allowed: readonly string[]): string[] {
  const permit = new Set(allowed.map((path) => path.replace(/\\/g, '/').replace(/^\.\//, '')));
  const rejected: string[] = [];
  for (const step of plan.steps) {
    for (const point of step.acceptance) {
      if (point.kind !== 'file-exists' && point.kind !== 'file-contains') continue;
      const path = point.params.path;
      if (typeof path !== 'string' || !path.trim()) continue;
      const normalised = path.replace(/\\/g, '/').replace(/^\.\//, '');
      if (!coveredByEnum(normalised, permit)) rejected.push(normalised);
    }
  }
  return [...new Set(rejected)];
}

/**
 * Workspace summarisation.
 *
 * Whitepaper §5.5: deterministic file location must not depend on the model. The
 * planner and clarifier are given a *bounded, authoritative* listing so they can
 * only reference paths that actually exist.
 * @module
 */

import type { FsPort } from '@camelia/core';

const DEFAULT_IGNORE = ['node_modules', '.git', 'dist', 'coverage', '.turbo', 'target', '.next'];

export interface WorkspaceSummaryOptions {
  maxEntries?: number;
  ignore?: string[];
}

/**
 * Render a compact listing of the workspace: directories first, then files.
 * Output is capped so a large repo cannot blow the planner's context.
 */
export async function workspaceSummary(
  fs: FsPort,
  workspace: string,
  options: WorkspaceSummaryOptions = {},
): Promise<string> {
  const maxEntries = options.maxEntries ?? 120;
  let entries: { path: string; type: string; size?: number }[];
  try {
    entries = await fs.list(workspace, {
      recursive: true,
      maxEntries: maxEntries * 2,
      ignore: options.ignore ?? DEFAULT_IGNORE,
    });
  } catch {
    return '(workspace listing unavailable)';
  }

  const files = entries.filter((e) => e.type === 'file');
  const dirs = entries.filter((e) => e.type === 'dir');

  const shownFiles = files.slice(0, maxEntries);
  const lines: string[] = [];
  if (dirs.length) {
    lines.push(`dirs: ${dirs.slice(0, 20).map((d) => d.path).join(', ')}`);
  }
  for (const file of shownFiles) {
    lines.push(`  ${file.path}${file.size !== undefined ? ` (${file.size}b)` : ''}`);
  }
  if (files.length > shownFiles.length) {
    lines.push(`  ... and ${files.length - shownFiles.length} more files`);
  }
  if (lines.length === 0) return '(workspace is empty)';
  return lines.join('\n');
}

/** A tiny digest of the workspace used for loop/state fingerprints. */
export function workspaceDigest(paths: string[]): string {
  return paths.slice(0, 50).sort().join('|');
}
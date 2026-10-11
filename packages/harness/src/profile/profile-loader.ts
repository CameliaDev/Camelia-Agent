/**
 * Project profile loader (Iteration 24).
 *
 * Before planning, the loop asks for the profile of the current workspace. If a
 * matching `~/.camelia/profiles/<name>.yaml` exists, its conventions / pitfalls /
 * verification / forbidden rules are fed into the plan prompt so the planner does
 * not repeat the project's known mistakes.
 *
 * Matching a workspace to a profile is deliberately tolerant:
 *   1. exact file candidates from the workspace basename (`Camelia-Agent.yaml`,
 *      `camelia-agent.yml`, ...);
 *   2. a directory scan fallback: the first profile whose `name:` field is the
 *      workspace basename (case-insensitive) or a prefix of it — so a profile
 *      authored as `name: camelia` matches the workspace `Camelia-Agent`.
 *
 * The loader never throws: a missing, unreadable or malformed profile leaves the
 * task running and logs the reason (a bad profile must not kill a task).
 * @module
 */

import path from 'node:path';

import type { FsPort, LoggerPort } from '@camelia/core';

import { parseProjectProfile, type ProjectProfile } from './project-profile.js';

/**
 * Candidate file names for a workspace, in priority order: exact basename first,
 * then lowercase — a profile authored as `camelia-agent.yaml` matches a workspace
 * named `Camelia-Agent` via its lowercase form.
 */
export function profileCandidates(workspace: string): string[] {
  const base = path.basename(workspace) || 'workspace';
  const names = [base, base.toLowerCase()];
  const files: string[] = [];
  for (const name of names) {
    files.push(`${name}.yaml`, `${name}.yml`);
  }
  return files;
}

/**
 * Read the project profile for `workspace` from `profileDir`, if present.
 * Returns `undefined` when no profile matches, when reading fails, or when the
 * file is malformed — in the latter two cases the reason is logged so the loop
 * can continue planning without it.
 */
export async function loadProfileForWorkspace(
  fs: FsPort,
  profileDir: string | undefined,
  workspace: string,
  logger?: LoggerPort,
): Promise<ProjectProfile | undefined> {
  if (!profileDir) return undefined;
  for (const fileName of profileCandidates(workspace)) {
    const filePath = path.join(profileDir, fileName);
    let text: string;
    try {
      if (!(await fs.exists(filePath))) continue;
      text = await fs.readFile(filePath);
    } catch (error) {
      logger?.warn('project profile unreadable; continuing without it', {
        file: filePath,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    const profile = parseOrSkip(text, filePath, logger);
    if (profile) return profile;
    // A malformed exact candidate is logged and we keep looking — one bad file
    // must not hide another good one.
  }

  // Fallback: the profile may be authored under a project name rather than the
  // directory name (`~/.camelia/profiles/camelia.yaml` for workspace
  // `Camelia-Agent`). Scan the directory and match on the `name:` field.
  return scanProfiles(fs, profileDir, workspace, logger);
}

/** Match rule for the scan fallback: the profile's `name` is the workspace
 * basename (case-insensitive) or a prefix of it, at least 4 chars to avoid
 * noise matches. */
export function profileMatchesWorkspace(profileName: string, workspace: string): boolean {
  const name = profileName.toLowerCase();
  const base = (path.basename(workspace) || 'workspace').toLowerCase();
  if (name.length < 4) return false;
  return base === name || base.startsWith(name);
}

async function scanProfiles(
  fs: FsPort,
  profileDir: string,
  workspace: string,
  logger?: LoggerPort,
): Promise<ProjectProfile | undefined> {
  let entries: Array<{ name: string; path: string; type: string }>;
  try {
    entries = (await fs.list(profileDir, { maxEntries: 100 })).filter(
      (entry) => entry.type === 'file' && /\.ya?ml$/i.test(entry.name),
    );
  } catch {
    return undefined; // directory missing or unlistable — no profiles to scan
  }
  for (const entry of entries) {
    const filePath = path.join(profileDir, entry.name);
    let text: string;
    try {
      text = await fs.readFile(filePath);
    } catch (error) {
      logger?.warn('project profile unreadable during scan; skipping', {
        file: filePath,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    const profile = parseOrSkip(text, filePath, logger);
    if (profile && profileMatchesWorkspace(profile.name, workspace)) {
      logger?.info('project profile loaded (scan fallback)', { file: filePath, name: profile.name });
      return profile;
    }
  }
  return undefined;
}

/** Parse a profile file; a malformed file is logged and yields `undefined`. */
function parseOrSkip(text: string, filePath: string, logger?: LoggerPort): ProjectProfile | undefined {
  try {
    return parseProjectProfile(text);
  } catch (error) {
    logger?.warn('project profile malformed; skipping', {
      file: filePath,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

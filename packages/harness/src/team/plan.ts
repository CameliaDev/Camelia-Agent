/**
 * Coordinator output for a Term team.
 *
 * The model must return a workers array. An empty list or prose is a failure,
 * not a cue to invent a worker and call the run done.
 * @module
 */

import { extractJsonObject } from '../planning/json.js';

export interface TeamWorkerSpec {
  role: string;
  goal: string;
  requireVision?: boolean;
  minContextTokens?: number;
  requireTools?: boolean;
  focusPaths?: string[];
}

const VISION_GOAL = /vision|screenshot|截图|图片|看图|照片|示意图|image|diagram/i;

/** The user asked someone to look at an image, even if the coordinator forgot the flag. */
export function goalNeedsVision(goal: string): boolean {
  return VISION_GOAL.test(goal);
}

export function applyVisionHint(goal: string, workers: TeamWorkerSpec[]): TeamWorkerSpec[] {
  if (!goalNeedsVision(goal)) return workers;
  if (workers.some((worker) => worker.requireVision)) return workers;
  const [first, ...rest] = workers;
  if (!first) return workers;
  return [{ ...first, requireVision: true }, ...rest];
}

export function parseTeamWorkers(text: string): { ok: true; workers: TeamWorkerSpec[] } | { ok: false; reason: string } {
  const parsed = extractJsonObject<{ workers?: unknown }>(text);
  if (!parsed || !Array.isArray(parsed.workers)) {
    return { ok: false, reason: 'coordinator did not return a workers array' };
  }
  const workers: TeamWorkerSpec[] = [];
  for (const row of parsed.workers) {
    if (!row || typeof row !== 'object') continue;
    const record = row as Record<string, unknown>;
    const goal = typeof record.goal === 'string' ? record.goal.trim() : '';
    if (!goal) continue;
    const role = typeof record.role === 'string' && record.role.trim() ? record.role.trim() : 'worker';
    const min = typeof record.minContextTokens === 'number' && record.minContextTokens > 0
      ? Math.floor(record.minContextTokens)
      : undefined;
    const focusPaths = Array.isArray(record.focusPaths)
      ? record.focusPaths.filter((path): path is string => typeof path === 'string' && path.trim().length > 0).map((path) => path.trim())
      : undefined;
    workers.push({
      role,
      goal,
      ...(record.requireVision === true ? { requireVision: true } : {}),
      ...(min ? { minContextTokens: min } : {}),
      ...(record.requireTools === true ? { requireTools: true } : {}),
      ...(focusPaths && focusPaths.length > 0 ? { focusPaths } : {}),
    });
  }
  if (workers.length === 0) return { ok: false, reason: 'coordinator returned no workers' };
  return { ok: true, workers };
}

export const TEAM_COORDINATOR_SYSTEM = [
  'You are the team coordinator of Camelia.',
  'Split the user goal into 1 to 4 isolated worker tasks. You do not do the work yourself.',
  'Reply with JSON only, no markdown:',
  '{"workers":[{"role":"short role","goal":"one concrete outcome","requireVision":false,"minContextTokens":0,"requireTools":false,"focusPaths":[]}]}',
  'Rules:',
  '- workers must be a non-empty array.',
  '- requireVision is true only when that worker must read an image, screenshot, or diagram.',
  '- minContextTokens is a hard minimum context window in tokens, or 0 when you do not know.',
  '- requireTools is true when the worker must read or write files or run commands.',
  '- focusPaths are workspace-relative files that worker may touch.',
].join('\n');

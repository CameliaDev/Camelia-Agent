/**
 * Residual routers.
 *
 * Track A adds and removes candidates. Track B only reorders the list A
 * already produced, and only after the current heuristic version has a group
 * of at least 20 attempts. Older versions can move a score, at half weight,
 * once that group is open. They cannot open it.
 * @module
 */

import {
  OLD_HEURISTIC_WEIGHT,
  ROUTER_B_MIN_GROUP,
  UNKNOWN_ACTION_FALLBACK,
  type AdviseActionId,
  type AdviseErrorClass,
  type EnvironmentStatus,
  type RouterASource,
} from '@camelia/core';

import type { HeuristicTable } from './heuristic.js';

const ENV_FAIL_FALLBACK: readonly AdviseActionId[] = ['repair_environment', 'escalate_human'];

export interface RouterAResult {
  readonly candidates: readonly AdviseActionId[];
  readonly source: RouterASource;
  readonly heuristicTableVersion: string;
  readonly ruleIds: readonly string[];
}

export interface ActionSample {
  readonly errorClass: AdviseErrorClass;
  readonly actionId: AdviseActionId;
  readonly heuristicTableVersion: string;
  readonly attempts: number;
  readonly successes: number;
}

export interface RouterBResult {
  readonly order: readonly AdviseActionId[];
  readonly ranked: boolean;
  readonly topScore: number | null;
}

export function routeA(input: {
  errorClass: AdviseErrorClass;
  environment: EnvironmentStatus;
  table: HeuristicTable;
}): RouterAResult {
  const enabled = input.table.rules.filter((rule) => rule.enabled && rule.errorClass === input.errorClass);
  const version = input.table.heuristic_table_version;

  if (input.environment === 'FAIL') {
    const matched = enabled.filter((rule) => rule.environment === 'FAIL').sort(byPriority);
    const candidates = dedupe(matched.flatMap((rule) => [...rule.candidates]));
    if (candidates.length === 0) {
      return { candidates: [...ENV_FAIL_FALLBACK], source: 'environment-fail', heuristicTableVersion: version, ruleIds: [] };
    }
    return { candidates, source: 'environment-fail', heuristicTableVersion: version, ruleIds: matched.map((rule) => rule.id) };
  }

  if (input.environment === 'UNKNOWN') {
    const matched = enabled.filter((rule) => rule.environment === 'UNKNOWN').sort(byPriority);
    const candidates = dedupe(matched.flatMap((rule) => [...rule.candidates]));
    if (candidates.length === 0) {
      return {
        candidates: [...UNKNOWN_ACTION_FALLBACK],
        source: 'environment-unknown-batch',
        heuristicTableVersion: version,
        ruleIds: [],
      };
    }
    return {
      candidates,
      source: 'environment-unknown-batch',
      heuristicTableVersion: version,
      ruleIds: matched.map((rule) => rule.id),
    };
  }

  const matched = enabled.filter((rule) => rule.environment === undefined || rule.environment === 'OK').sort(byPriority);
  const candidates = dedupe(matched.flatMap((rule) => [...rule.candidates]));
  if (candidates.length === 0) {
    return {
      candidates: [...UNKNOWN_ACTION_FALLBACK],
      source: 'unknown-fallback',
      heuristicTableVersion: version,
      ruleIds: [],
    };
  }
  return { candidates, source: 'table', heuristicTableVersion: version, ruleIds: matched.map((rule) => rule.id) };
}

export function routeB(input: {
  errorClass: AdviseErrorClass;
  candidates: readonly AdviseActionId[];
  samples: readonly ActionSample[];
  currentVersion: string;
}): RouterBResult {
  const order = [...input.candidates];
  const relevant = input.samples.filter((sample) => sample.errorClass === input.errorClass);
  const currentAttempts = relevant
    .filter((sample) => sample.heuristicTableVersion === input.currentVersion)
    .reduce((sum, sample) => sum + sample.attempts, 0);
  if (currentAttempts < ROUTER_B_MIN_GROUP) {
    return { order, ranked: false, topScore: null };
  }

  const scored = order.map((actionId, index) => ({ actionId, index, score: scoreOf(relevant, actionId, input.currentVersion) }));
  scored.sort((left, right) => {
    const leftKnown = left.score !== null;
    const rightKnown = right.score !== null;
    if (leftKnown !== rightKnown) return leftKnown ? -1 : 1;
    if (left.score !== null && right.score !== null && left.score !== right.score) return right.score - left.score;
    const leftCurrent = attemptsAt(relevant, left.actionId, input.currentVersion, true);
    const rightCurrent = attemptsAt(relevant, right.actionId, input.currentVersion, true);
    if (leftCurrent !== rightCurrent) return rightCurrent - leftCurrent;
    return left.index - right.index;
  });
  return {
    order: scored.map((row) => row.actionId),
    ranked: true,
    topScore: scored[0]?.score ?? null,
  };
}

function scoreOf(samples: readonly ActionSample[], actionId: AdviseActionId, currentVersion: string): number | null {
  let attempts = 0;
  let successes = 0;
  for (const sample of samples) {
    if (sample.actionId !== actionId) continue;
    const weight = sample.heuristicTableVersion === currentVersion ? 1 : OLD_HEURISTIC_WEIGHT;
    attempts += weight * sample.attempts;
    successes += weight * sample.successes;
  }
  if (attempts <= 0) return null;
  return successes / attempts;
}

function attemptsAt(samples: readonly ActionSample[], actionId: AdviseActionId, version: string, current: boolean): number {
  return samples
    .filter((sample) => sample.actionId === actionId && (sample.heuristicTableVersion === version) === current)
    .reduce((sum, sample) => sum + sample.attempts, 0);
}

function byPriority(left: { priority: number; id: string }, right: { priority: number; id: string }): number {
  if (left.priority !== right.priority) return right.priority - left.priority;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function dedupe(candidates: readonly AdviseActionId[]): AdviseActionId[] {
  const seen = new Set<AdviseActionId>();
  const out: AdviseActionId[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    out.push(candidate);
  }
  return out;
}

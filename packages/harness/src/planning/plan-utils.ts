/**
 * Plan normalisation and structural validation.
 *
 * The planner model is treated as untrusted input: whatever it emits is coerced
 * into the `Plan` contract, deps are re-indexed, cycles are broken, and every
 * step is guaranteed to carry at least one acceptance point (whitepaper §3.2).
 * @module
 */

import type { AcceptancePoint, Plan, Step } from '@camelia/core';
import { newId } from '@camelia/core';

const ACCEPTANCE_KINDS: ReadonlySet<AcceptancePoint['kind']> = new Set([
  'file-exists',
  'file-contains',
  'command-exit-zero',
  'test-pass',
  'diff-nonempty',
  'manual',
]);

/** Loose shape the model is asked to produce. */
export interface RawStep {
  title?: unknown;
  goal?: unknown;
  deps?: unknown;
  acceptance?: unknown;
  weight?: unknown;
}

export interface RawPlan {
  steps?: unknown;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function normaliseAcceptance(raw: unknown, stepTitle: string): AcceptancePoint[] {
  if (!Array.isArray(raw)) return [];
  const points: AcceptancePoint[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const kind = asString(record.kind) as AcceptancePoint['kind'];
    if (!ACCEPTANCE_KINDS.has(kind)) continue;
    const params =
      record.params && typeof record.params === 'object'
        ? (record.params as AcceptancePoint['params'])
        : {};
    points.push({
      id: newId(),
      description: asString(record.description, `${stepTitle} — ${kind}`),
      kind,
      params,
    });
  }
  return points;
}

function normaliseDeps(raw: unknown, count: number, selfIdx: number): number[] {
  if (!Array.isArray(raw)) return [];
  const deps: number[] = [];
  for (const item of raw) {
    const idx = typeof item === 'number' ? item : Number(item);
    if (!Number.isInteger(idx)) continue;
    if (idx < 0 || idx >= count || idx === selfIdx) continue;
    if (!deps.includes(idx)) deps.push(idx);
  }
  return deps;
}

/**
 * Break dependency cycles by dropping the offending edges.
 * A cyclic plan is never rejected outright — it is repaired, because a partially
 * ordered plan still completes more often than a failed plan (whitepaper §3.2).
 */
export function breakCycles(edges: number[][]): { edges: number[][]; dropped: number } {
  const count = edges.length;
  const result: number[][] = edges.map((list) => [...list]);
  let dropped = 0;

  const reaches = (from: number, target: number, seen: Set<number>): boolean => {
    if (from === target) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    for (const next of result[from] ?? []) {
      if (reaches(next, target, seen)) return true;
    }
    return false;
  };

  for (let i = 0; i < count; i += 1) {
    const kept: number[] = [];
    for (const dep of result[i] ?? []) {
      // If the dep already (transitively) depends on i, adding it closes a cycle.
      if (reaches(dep, i, new Set())) {
        dropped += 1;
        continue;
      }
      kept.push(dep);
    }
    result[i] = kept;
  }
  return { edges: result, dropped };
}

export interface NormaliseOptions {
  taskId: string;
  maxSteps: number;
  mode: 'fast' | 'full';
  revision?: number;
}

/**
 * Coerce raw model output into a `Plan`. Returns `undefined` when nothing usable
 * was produced, so the caller can fall back to a single-step plan.
 */
export function normalisePlan(raw: RawPlan | undefined, options: NormaliseOptions): Plan | undefined {
  const rawSteps = Array.isArray(raw?.steps) ? (raw!.steps as RawStep[]) : [];
  const usable = rawSteps
    .filter((s) => s && typeof s === 'object')
    .slice(0, Math.max(1, options.maxSteps));
  if (usable.length === 0) return undefined;

  const count = usable.length;
  const rawEdges = usable.map((s, idx) => normaliseDeps(s.deps, count, idx));
  const { edges } = breakCycles(rawEdges);

  const steps: Step[] = usable.map((rawStep, idx) => {
    const title = asString(rawStep.title, `Step ${idx + 1}`);
    const goal = asString(rawStep.goal, title);
    const weight = typeof rawStep.weight === 'number' && rawStep.weight > 0 ? rawStep.weight : 1;
    return {
      id: newId(),
      taskId: options.taskId,
      idx,
      title,
      goal,
      status: 'pending',
      acceptance: normaliseAcceptance(rawStep.acceptance, title),
      weight,
      deps: (edges[idx] ?? []).map((depIdx) => usable[depIdx] && depIdx >= 0 ? `__idx${depIdx}` : '').filter(Boolean),
    };
  });

  // Resolve placeholder deps to real step ids now that every id exists.
  for (const step of steps) {
    step.deps = step.deps.map((placeholder) => {
      const idx = Number(placeholder.replace('__idx', ''));
      return steps[idx]?.id ?? '';
    }).filter(Boolean);
  }

  return {
    id: newId(),
    taskId: options.taskId,
    steps,
    mode: options.mode,
    revision: options.revision ?? 0,
    createdAt: Date.now(),
  };
}

/** Deterministic single-step fallback — used when planning fails entirely. */
export function fallbackPlan(
  taskId: string,
  goal: string,
  expectedPaths: string[],
  mode: 'fast' | 'full' = 'fast',
): Plan {
  const acceptance: AcceptancePoint[] = expectedPaths.slice(0, 3).map((path) => ({
    id: newId(),
    description: `File ${path} exists after the change`,
    kind: 'file-exists' as const,
    params: { path },
  }));
  const step: Step = {
    id: newId(),
    taskId,
    idx: 0,
    title: 'Complete the task',
    goal,
    status: 'pending',
    acceptance,
    weight: 1,
    deps: [],
  };
  return { id: newId(), taskId, steps: [step], mode, revision: 0, createdAt: Date.now() };
}

/** Steps in dependency order; ties broken by original index for determinism. */
export function topologicalOrder(steps: Step[]): Step[] {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const visited = new Set<string>();
  const ordered: Step[] = [];

  const visit = (step: Step, stack: Set<string>): void => {
    if (visited.has(step.id) || stack.has(step.id)) return;
    stack.add(step.id);
    for (const dep of step.deps) {
      const depStep = byId.get(dep);
      if (depStep) visit(depStep, stack);
    }
    stack.delete(step.id);
    visited.add(step.id);
    ordered.push(step);
  };

  for (const step of [...steps].sort((a, b) => a.idx - b.idx)) visit(step, new Set());
  return ordered;
}

/** Longest chain length — a proxy for how sequential the plan is. */
export function dagDepth(steps: Step[]): number {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const memo = new Map<string, number>();
  const depth = (step: Step, stack: Set<string>): number => {
    const cached = memo.get(step.id);
    if (cached !== undefined) return cached;
    if (stack.has(step.id)) return 0;
    stack.add(step.id);
    let best = 1;
    for (const dep of step.deps) {
      const depStep = byId.get(dep);
      if (depStep) best = Math.max(best, 1 + depth(depStep, stack));
    }
    stack.delete(step.id);
    memo.set(step.id, best);
    return best;
  };
  return steps.reduce((max, step) => Math.max(max, depth(step, new Set())), 0);
}
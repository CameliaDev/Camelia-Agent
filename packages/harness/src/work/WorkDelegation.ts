/**
 * Main-AI delegation.
 *
 * The coordinator splits the goal (the same worker JSON `TeamOrchestrator` reads).
 * Each sub-AI thinks first. The token gate issues a token only for a real thought.
 * When a `TeamOrchestrator` is present, admitted workers are spawned through it.
 * Shared memory is prepended to the coordinator prompt and the worker prompt.
 * @module
 */

import type { TeamWorkerSpec } from '../team/plan.js';
import { parseTeamWorkers } from '../team/plan.js';
import type { TeamOrchestrator } from '../team/TeamOrchestrator.js';
import type { SubAgentSpec } from '../subagent/SubAgentOrchestrator.js';
import type { WorkThought, WorkToken, WorkTokenGate } from './WorkTokenGate.js';
import type { WorkTokenNotice } from './gated-worker.js';

export interface WorkDelegateReport {
  ok: boolean;
  summary: string;
  workers: number;
  handedBack: number;
}

export interface WorkDelegateDeps {
  goal: string;
  constraints: string[];
  /** Curated recall already rendered as lines. Empty when the store has nothing. */
  memory: string;
  planText: (prompt: string) => Promise<string>;
  think: (worker: TeamWorkerSpec, memory: string) => Promise<WorkThought | undefined>;
  gate: WorkTokenGate;
  /** Issued tokens, keyed by worker goal, for the runner the team spawns. */
  tokens: Map<string, WorkToken>;
  allowedTools: readonly string[];
  maxToolCalls?: number;
  /** Reuse the Term orchestrator when the caller has one. */
  team?: TeamOrchestrator;
  /** Used only when `team` is absent. */
  runWorker?: (worker: TeamWorkerSpec, token: WorkToken) => Promise<{ status: 'ok' | 'error'; summary: string }>;
  onToken?: (notice: WorkTokenNotice) => void;
}

export async function delegateWork(deps: WorkDelegateDeps): Promise<WorkDelegateReport> {
  const memory = deps.memory.trim();
  const prompt = [
    deps.goal,
    deps.constraints.length ? `Constraints: ${deps.constraints.join(' | ')}` : '',
    memory ? `Shared memory:\n${memory}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  let text: string;
  try {
    text = await deps.planText(prompt);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, summary: `coordinator failed: ${reason}`, workers: 0, handedBack: 0 };
  }

  const parsed = parseTeamWorkers(text);
  if (!parsed.ok) {
    return { ok: false, summary: parsed.reason, workers: 0, handedBack: 0 };
  }

  const runnable: TeamWorkerSpec[] = [];
  const notes: string[] = [];
  let handedBack = 0;

  for (const worker of parsed.workers) {
    let thought: WorkThought | undefined;
    try {
      thought = await deps.think(worker, memory);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      handedBack += 1;
      notes.push(`${worker.role}: thought failed (${reason}) — handed back`);
      deps.onToken?.({ tokenId: '', holderId: worker.role, status: 'denied', reason });
      continue;
    }
    const issued = deps.gate.issue(worker.role, thought, {
      allowedTools: worker.requireTools === false ? [] : deps.allowedTools,
      pathPrefixes: worker.focusPaths ?? [],
      maxToolCalls: deps.maxToolCalls ?? 8,
    });
    if (!issued.ok) {
      handedBack += 1;
      notes.push(`${worker.role}: ${issued.reason}`);
      deps.onToken?.({ tokenId: '', holderId: worker.role, status: 'denied', reason: issued.reason });
      continue;
    }
    deps.tokens.set(worker.goal, issued.token);
    deps.onToken?.({ tokenId: issued.token.id, holderId: worker.role, status: 'issued' });
    runnable.push(worker);
  }

  if (runnable.length === 0) {
    return {
      ok: false,
      summary: ['No sub-AI received a work token.', ...notes].join('\n'),
      workers: 0,
      handedBack,
    };
  }

  if (deps.team) {
    const outcome = await deps.team.dispatch(deps.goal, runnable, async (spec: SubAgentSpec) => {
      const token = deps.tokens.get(spec.goal);
      if (!token || token.status !== 'active') return { ok: false, reason: 'no token — tools are refused' };
      return { ok: true };
    });
    return {
      ok: outcome.status === 'done',
      summary: [outcome.summary, ...notes].filter(Boolean).join('\n'),
      workers: outcome.workersRan,
      handedBack: handedBack + (outcome.handedBack ?? 0),
    };
  }

  if (!deps.runWorker) {
    return { ok: false, summary: 'sub-AI runner is not configured', workers: 0, handedBack };
  }

  const lines = [...notes];
  let okCount = 0;
  for (const worker of runnable) {
    const token = deps.tokens.get(worker.goal);
    if (!token) {
      handedBack += 1;
      lines.push(`${worker.role}: no token — tools are refused`);
      continue;
    }
    const report = await deps.runWorker(worker, token);
    if (report.status === 'ok') okCount += 1;
    else handedBack += 1;
    lines.push(`- [${report.status}] ${worker.role}: ${report.summary}`);
  }
  return {
    ok: okCount > 0,
    summary: lines.join('\n'),
    workers: runnable.length,
    handedBack,
  };
}

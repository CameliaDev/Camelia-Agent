/**
 * Synthetic DomainEvent corpus for the Phase 0 backtest.
 *
 * SIMULATED. This machine has no user `events` table to replay. The sequences
 * use the real event names and payload shapes (`plan.ready`, `step.started`,
 * `tool.requested`, `tool.finished` / `tool.failed`, `verify.result`,
 * `step.completed`, `provider.capabilities`). Outcomes are a fixed function of
 * the situation, not a random draw, so the report is reproducible.
 *
 * Rates differ by capability and archetype on purpose: that is the hypothesis
 * §4.2 is for. The generator does not look at the estimator.
 * @module
 */

import type { ReplayEvent } from './backtest.js';

interface SessionSpec {
  id: string;
  quality: number;
  supportsTools: boolean;
  textToolCalls: boolean;
}

interface Pattern {
  id: string;
  session: SessionSpec;
  title: string;
  goal: string;
  acceptancePaths: readonly string[];
  touched: readonly string[];
  tool: string;
  toolCount: number;
  durationMs: number;
  repeats: number;
  pass: (index: number) => boolean;
  toolError: (index: number) => boolean;
}

const TOOL: SessionSpec = { id: 'ses_tool', quality: 0.72, supportsTools: true, textToolCalls: false };
const TEXT: SessionSpec = { id: 'ses_text', quality: 0.4, supportsTools: true, textToolCalls: true };
const NONE: SessionSpec = { id: 'ses_none', quality: 0.3, supportsTools: false, textToolCalls: false };

/** Spread `numer` hits across `denom` so the first samples already resemble the rate. */
function atRate(numer: number, denom: number): (index: number) => boolean {
  return (index) => ((index % denom) * numer) % denom < numer;
}

const PATTERNS: readonly Pattern[] = [
  {
    id: 'read',
    session: TOOL,
    title: 'Read src/a.ts',
    goal: 'Read the file',
    acceptancePaths: ['src/a.ts'],
    touched: ['src/a.ts'],
    tool: 'fs.read',
    toolCount: 1,
    durationMs: 400,
    repeats: 16,
    pass: atRate(19, 20),
    toolError: atRate(1, 20),
  },
  {
    id: 'edit',
    session: TOOL,
    title: 'Edit src/a.ts and src/b.ts',
    goal: 'Update both modules',
    acceptancePaths: ['src/a.ts', 'src/b.ts'],
    touched: ['src/a.ts', 'src/b.ts'],
    tool: 'fs.edit',
    toolCount: 4,
    durationMs: 2400,
    repeats: 16,
    pass: atRate(14, 20),
    toolError: atRate(2, 20),
  },
  {
    id: 'exec',
    session: TOOL,
    title: 'Run build src/app.ts',
    goal: 'Execute the build command',
    acceptancePaths: ['src/app.ts'],
    touched: [],
    tool: 'shell.exec',
    toolCount: 2,
    durationMs: 7000,
    repeats: 16,
    pass: atRate(5, 20),
    toolError: atRate(4, 20),
  },
  {
    id: 'text-edit',
    session: TEXT,
    title: 'Edit src/a.ts and src/b.ts',
    goal: 'Fix both modules',
    acceptancePaths: ['src/a.ts', 'src/b.ts'],
    touched: ['src/a.ts', 'src/b.ts'],
    tool: 'fs.edit',
    toolCount: 5,
    durationMs: 3200,
    repeats: 16,
    pass: atRate(7, 20),
    toolError: atRate(11, 20),
  },
  {
    id: 'text-read',
    session: TEXT,
    title: 'Read src/a.ts',
    goal: 'Read the config',
    acceptancePaths: ['src/a.ts'],
    touched: ['src/a.ts'],
    tool: 'fs.read',
    toolCount: 1,
    durationMs: 600,
    repeats: 16,
    pass: atRate(16, 20),
    toolError: atRate(5, 20),
  },
  {
    id: 'research',
    session: NONE,
    title: 'Search for callers',
    goal: 'Find references in the docs',
    acceptancePaths: [],
    touched: [],
    tool: 'search.query',
    toolCount: 0,
    durationMs: 1500,
    repeats: 16,
    pass: atRate(10, 20),
    toolError: () => false,
  },
];

/**
 * Deterministic event log. 6 situations × 16 repeats, then 4 edit steps whose
 * in-degree is 1 (a later verify step depends on them) so L3 is cold while L2
 * is already warm.
 */
export function syntheticCognitionCorpus(): ReplayEvent[] {
  const events: ReplayEvent[] = [];
  let seq = 0;
  let ts = 1_700_000_000_000;
  const seenSessions = new Set<string>();

  const push = (type: string, payload: unknown, taskId: string | undefined, sessionId: string, at?: number): void => {
    if (at !== undefined) ts = at;
    else ts += 1;
    seq += 1;
    events.push({ seq, sessionId, taskId, type, payload, traceId: 'trc_synth', ts });
  };

  const emitCaps = (session: SessionSpec): void => {
    if (seenSessions.has(session.id)) return;
    seenSessions.add(session.id);
    push(
      'provider.capabilities',
      {
        providerId: 'synthetic',
        capabilities: {
          supportsTools: session.supportsTools,
          textToolCalls: session.textToolCalls,
          supportsJson: true,
          supportsStreaming: true,
          maxContextWindow: 8192,
          quality: session.quality,
        },
      },
      undefined,
      session.id,
    );
  };

  const emitStep = (
    pattern: Pattern,
    index: number,
    taskId: string,
    stepId: string,
    title: string,
    goal: string,
    deps: string[],
    extraSteps: { id: string; title: string; goal: string; deps: string[] }[],
  ): void => {
    emitCaps(pattern.session);
    const sessionId = pattern.session.id;
    const now = ts;
    push(
      'task.received',
      {
        task: {
          id: taskId,
          sessionId,
          intentRaw: title,
          status: 'received',
          phase: 'idle',
          progress: 0,
          createdAt: now,
          updatedAt: now,
        },
      },
      taskId,
      sessionId,
    );
    const acceptance = pattern.acceptancePaths.map((path, pathIndex) => ({
      id: `acc_${stepId}_${pathIndex}`,
      description: path,
      kind: 'file-exists',
      params: { path },
    }));
    const primary = {
      id: stepId,
      taskId,
      idx: 0,
      title,
      goal,
      status: 'pending',
      acceptance,
      weight: 1,
      deps,
    };
    const rest = extraSteps.map((step, stepIndex) => ({
      id: step.id,
      taskId,
      idx: stepIndex + 1,
      title: step.title,
      goal: step.goal,
      status: 'pending',
      acceptance: [],
      weight: 1,
      deps: step.deps,
    }));
    push(
      'plan.ready',
      {
        plan: {
          id: `plan_${taskId}`,
          taskId,
          steps: [primary, ...rest],
          mode: 'full',
          revision: 1,
          createdAt: ts,
        },
      },
      taskId,
      sessionId,
    );
    const startedAt = ts + 1;
    push('step.started', { step: { ...primary, status: 'running' } }, taskId, sessionId);
    const errorFirst = pattern.toolError(index);
    let durationBudget = pattern.durationMs;
    for (let toolIndex = 0; toolIndex < pattern.toolCount; toolIndex += 1) {
      const remaining = pattern.toolCount - toolIndex;
      const durationMs = Math.round(durationBudget / remaining);
      durationBudget -= durationMs;
      const path = pattern.touched[toolIndex] ?? pattern.touched[0];
      const callId = `call_${stepId}_${toolIndex}`;
      const fail = errorFirst && toolIndex === 0;
      push(
        'tool.requested',
        {
          call: {
            id: callId,
            stepId,
            taskId,
            name: pattern.tool,
            input: path ? { path } : { cmd: 'build' },
            status: 'running',
            risk: pattern.tool.startsWith('shell') ? 'privileged' : 'read-only',
            reversible: !pattern.tool.startsWith('shell'),
            traceId: 'trc_synth',
            createdAt: ts,
          },
        },
        taskId,
        sessionId,
      );
      if (fail) {
        push(
          'tool.failed',
          { callId, name: pattern.tool, error: 'synthetic tool error', recoverable: true },
          taskId,
          sessionId,
        );
      } else {
        push(
          'tool.finished',
          {
            call: {
              id: callId,
              stepId,
              taskId,
              name: pattern.tool,
              input: path ? { path } : { cmd: 'build' },
              status: 'ok',
              risk: 'read-only',
              reversible: true,
              durationMs,
              traceId: 'trc_synth',
              createdAt: ts,
            },
          },
          taskId,
          sessionId,
        );
      }
    }
    const status = pattern.pass(index) ? 'pass' : 'fail';
    push(
      'verify.result',
      {
        verdict: {
          id: `ver_${stepId}`,
          stepId,
          taskId,
          status,
          evidence: [],
          reason: 'synthetic observation',
          createdAt: ts,
        },
      },
      taskId,
      sessionId,
    );
    const artifacts = pattern.touched.map((path) => ({ kind: 'file', path }));
    const completedAt = pattern.toolCount === 0 ? startedAt + pattern.durationMs : undefined;
    push(
      'step.completed',
      {
        step: { ...primary, status: 'done' },
        result: { stepId, status: 'ok', toolCalls: [], summary: status, artifacts },
        score: status === 'pass' ? 1 : 0,
      },
      taskId,
      sessionId,
      completedAt,
    );
  };

  for (const pattern of PATTERNS) {
    for (let index = 0; index < pattern.repeats; index += 1) {
      const taskId = `tsk_${pattern.id}_${index}`;
      emitStep(pattern, index, taskId, `stp_${pattern.id}_${index}`, pattern.title, pattern.goal, [], []);
    }
  }

  const edit = PATTERNS[1]!;
  for (let index = 0; index < 4; index += 1) {
    const taskId = `tsk_edit_deg_${index}`;
    const stepId = `stp_edit_deg_${index}`;
    const verifyId = `stp_edit_deg_verify_${index}`;
    emitStep(edit, index, taskId, stepId, edit.title, edit.goal, [], [
      { id: verifyId, title: 'Verify the tests', goal: 'Verify the edit', deps: [stepId] },
    ]);
    emitStep(
      {
        ...edit,
        id: 'edit-verify',
        title: 'Verify the tests',
        goal: 'Verify the edit',
        acceptancePaths: [],
        touched: [],
        tool: 'shell.exec',
        toolCount: 1,
        durationMs: 900,
        pass: () => true,
        toolError: () => false,
      },
      index,
      taskId,
      verifyId,
      'Verify the tests',
      'Verify the edit',
      [stepId],
      [],
    );
  }

  return events;
}

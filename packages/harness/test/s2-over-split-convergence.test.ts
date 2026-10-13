/**
 * Stage 4.3 — weak-model two-file task breakdown (s2) reproduction + convergence.
 *
 * Field (Iteration 25, small sample, `qwen2.5-coder:7b`): the weak model split a
 * two-file task into 4 steps; step 1 executed a single `fs.list` and stopped, the
 * run failed with an empty workspace ("工具记录只有一次 fs.list，没有 fs.write；
 * 重规划后再执行，工具列表为空；计划被拆成 4 步").
 *
 * This test reproduces the same phenomenon deterministically — a scripted planner
 * over-splits the goal into 4 steps and the scripted executor only lists the
 * workspace then stops (no write) — and pins the mechanism facts:
 *
 * 1. A `file-exists` verification failure classifies as *permanent*: the recovery
 *    ladder does not burn fixup retries on it — it escalates straight to the
 *    single replan. The loop already converges; the task fails with an empty
 *    workspace and the `zero-tool-calls` failure mode is on record.
 * 2. On the *tool-class* failure path (where fixup retries DO run), a fixup that
 *    fails verification with zero tool calls stops the retry loop immediately
 *    (convergence guard, Iteration 26) instead of repeating empty attempts up to
 *    `maxRetries` times.
 * @module
 */

import { describe, expect, it } from 'vitest';

import { llmContentText } from '@camelia/core';

import { FakeShell, ScriptedLLM, makeHarness, makeIntent, type Harness } from './helpers/context.js';
import { buildEngine } from './helpers/engine.js';

const WS = 'C:/workspace';

/** Minimal plan-step shape understood by the scripted planner. */
interface RawStepSpec {
  title: string;
  goal?: string;
  deps?: number[];
  acceptance: Array<{ kind: string; params: Record<string, unknown>; description: string }>;
}

/** A planner turn: JSON-only plan body, exactly as the prompt requests. */
function planTurn(steps: RawStepSpec[]): { text: string } {
  return { text: JSON.stringify({ steps }) };
}

/** The executor only lists the workspace — exploration with no side effect. */
function listTurn() {
  return { text: '', toolCalls: [{ name: 'fs.list', arguments: { path: WS } }] };
}

/** The executor stops without calling any tool. */
const stopTurn = { text: 'the workspace is empty, nothing to change' };

function fileExists(path: string): RawStepSpec['acceptance'][number] {
  return { kind: 'file-exists', params: { path }, description: `${path} exists` };
}

function commandExitZero(command: string): RawStepSpec['acceptance'][number] {
  return { kind: 'command-exit-zero', params: { command }, description: `${command} exits 0` };
}

function eventTypes(h: Harness): string[] {
  return h.events.map((e) => e.type);
}

/** The weak model's over-split plan: 4 steps for a 2-file goal. */
function overSplitPlan(): RawStepSpec[] {
  return [
    { title: 'Create a.js', goal: 'create a.js', acceptance: [fileExists('a.js')] },
    { title: 'Create b.js', goal: 'create b.js', acceptance: [fileExists('b.js')] },
    { title: 'Verify both files', goal: 'verify a.js and b.js exist', acceptance: [fileExists('a.js'), fileExists('b.js')] },
    { title: 'Review result', goal: 'confirm the two files are present', acceptance: [fileExists('a.js'), fileExists('b.js')] },
  ];
}

describe('Stage 4.3 — s2 weak-model two-file breakdown', () => {
  it('reproduces the field failure shape: over-split plan, listing-only step, empty workspace', async () => {
    const llm = new ScriptedLLM([
      planTurn(overSplitPlan()),
      // Step 1 executes: one fs.list, then the model stops (no write).
      listTurn(),
      stopTurn,
      // Escalation: replan with the same weak model. The revised plan's step is
      // executed with no tool call at all — the model stops immediately, which is
      // the field's "重规划后再执行，工具列表为空".
      planTurn(overSplitPlan()),
      stopTurn,
    ]);
    const h = makeHarness({ llm });
    const { loop } = buildEngine(h);

    const outcome = await loop.run(makeIntent({ goal: 'create a.js and b.js at the root', expectedPaths: ['a.js', 'b.js'] }));

    expect(outcome.status).toBe('failed');
    // Nothing was written: the workspace is empty because the model never acted,
    // not because a write was rolled back (field: "工作区最后是空的，因为没有写入").
    expect(h.fs.files.has(`${WS}/a.js`)).toBe(false);
    expect(h.fs.files.has(`${WS}/b.js`)).toBe(false);

    // The zero-tool-calls failure mode is on record (next plan for this workspace
    // can read it) — same wiring as the field's "工具列表为空".
    expect(h.store.failureModes.some((row) => row.kind === 'zero-tool-calls')).toBe(true);

    // Mechanism fact: a file-exists verification failure classifies as permanent,
    // so the ladder escalates straight to the single replan — no fixup round is
    // burned, and the loop converges instead of looping.
    const fixupPrompts = llm.requests
      .map((request) => {
        const content = request.messages.find((message) => message.role === 'system')?.content;
        return content === undefined ? '' : llmContentText(content);
      })
      .filter((text) => text.includes('FAILED verification'));
    expect(fixupPrompts).toHaveLength(0);
    expect(eventTypes(h)).toContain('plan.revised');
  });

  it('stops retrying after a zero-tool-calls fixup on the tool-class path (convergence guard)', async () => {
    // Tool-class failure: the check command exits 1, so the recovery ladder DOES
    // retry. The fixup comes back with zero tool calls and still fails — the
    // guard must stop the retry loop after one empty fixup, not burn maxRetries.
    const llm = new ScriptedLLM([
      planTurn([{ title: 'Make check pass', acceptance: [commandExitZero('node check.mjs')] }]),
      listTurn(),
      stopTurn,
      stopTurn, // fixup #1 — zero tool calls → guard breaks the retry loop
      planTurn([{ title: 'Make check pass v2', acceptance: [commandExitZero('node check.mjs')] }]),
      stopTurn,
    ]);
    const shell = new FakeShell(() => ({ code: 1, stdout: 'ok' }));
    const h = makeHarness({ llm, shell });
    const { loop } = buildEngine(h);

    const outcome = await loop.run(makeIntent({ goal: 'make the check pass', expectedPaths: ['a.txt'] }));

    expect(outcome.status).toBe('failed');
    // Exactly one fixup execution: the fixup prompt appears once, not maxRetries
    // (3) times — the loop converged instead of repeating empty attempts.
    const fixupPrompts = llm.requests
      .map((request) => {
        const content = request.messages.find((message) => message.role === 'system')?.content;
        return content === undefined ? '' : llmContentText(content);
      })
      .filter((text) => text.includes('FAILED verification'));
    expect(fixupPrompts).toHaveLength(1);
  });
});

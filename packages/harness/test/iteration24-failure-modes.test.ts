import { describe, expect, it } from 'vitest';

import { makeIntent, makeHarness, ScriptedLLM } from './helpers/context.js';
import { buildEngine } from './helpers/engine.js';

/**
 * Iteration 24 鈥?the remaining failure modes are written by the mechanisms that
 * cause them (zero-tool-calls, context-exhaustion, declared-but-ineffective),
 * each row pointing at a code path, and the next plan can read them.
 *
 * All four are produced deterministically via ScriptedLLM 鈥?no live model.
 */

const workspace = 'C:/workspace';

function planJson(acceptancePath: string): string {
  return JSON.stringify({
    steps: [
      {
        title: `write ${acceptancePath}`,
        goal: `create ${acceptancePath}`,
        deps: [],
        acceptance: [{ description: `${acceptancePath} exists`, kind: 'file-exists', params: { path: acceptancePath } }],
      },
    ],
  });
}

describe('iteration 24 鈥?zero-tool-calls failure mode', () => {
  it('records a row when a step fails verification without any tool call', async () => {
    const h = makeHarness({
      workspace,
      config: { planApproval: 'auto', maxRetries: 0 },
      llm: new ScriptedLLM([
        { text: planJson('a.txt') },
        // The model declares completion as text and never calls a tool.
        { text: 'done' },
      ]),
    });
    const { loop } = buildEngine(h);
    const outcome = await loop.run(makeIntent({ expectedPaths: ['a.txt'] }));

    expect(outcome.status).toBe('failed');
    expect(await h.store.countFailureModes(workspace, 'zero-tool-calls')).toBeGreaterThanOrEqual(1);
    const row = h.store.failureModes.find((r) => r.kind === 'zero-tool-calls');
    expect(row?.mechanism).toContain('executor');
  });
});

describe('iteration 24 鈥?context-exhaustion failure mode', () => {
  it('records a row when context usage reaches the hard window before a model call', async () => {
    const h = makeHarness({
      workspace,
      config: { planApproval: 'auto', contextWindow: 60, softLimitRatio: 0.8 },
      llm: new ScriptedLLM([
        { text: planJson('a.txt') },
        { text: '', toolCalls: [{ name: 'fs.write', arguments: { path: 'a.txt', content: 'x' } }] },
        { text: 'wrote a.txt' },
      ]),
    });
    const { loop } = buildEngine(h);
    // A long goal + wide constraints push the protected-slot render over the
    // tiny window, so the executor's pre-call check fires deterministically.
    const outcome = await loop.run(
      makeIntent({
        goal: 'Add a CONTRIBUTING.md file'.repeat(20),
        constraints: ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta'],
        expectedPaths: ['a.txt'],
      }),
    );

    expect(outcome.status).toBe('done');
    expect(await h.store.countFailureModes(workspace, 'context-exhaustion')).toBeGreaterThanOrEqual(1);
    const row = h.store.failureModes.find((r) => r.kind === 'context-exhaustion');
    expect(row?.mechanism).toContain('ContextManager.tokenUsage');
  });
});

describe('iteration 24 鈥?declared-but-ineffective failure mode', () => {
  it('records a row when the output drifts away from the goal', async () => {
    const h = makeHarness({
      workspace,
      config: { planApproval: 'auto', driftThreshold: 0.45 },
      llm: new ScriptedLLM([
        { text: planJson('a.txt') },
        {
          text: 'touching a.txt',
          toolCalls: [{ name: 'fs.write', arguments: { path: 'a.txt', content: 'x' } }],
        },
        // Unrelated summary: high intent divergence + file set divergence.
        { text: 'the weather is nice and completely unrelated to any goal' },
      ]),
    });
    const { loop } = buildEngine(h);
    const outcome = await loop.run(
      makeIntent({ goal: 'Add a CONTRIBUTING.md file', expectedPaths: ['a.txt', 'b.txt'] }),
    );

    expect(outcome.status).toBe('done');
    expect(await h.store.countFailureModes(workspace, 'declared-but-ineffective')).toBeGreaterThanOrEqual(1);
    const row = h.store.failureModes.find((r) => r.kind === 'declared-but-ineffective');
    expect(row?.mechanism).toContain('DriftDetector.assess');
  });
});

/**
 * Phase 4 loop wiring. `advise` records a ticket. It does not change the plan
 * or the workspace relative to `observe`.
 */
import { describe, expect, it } from 'vitest';

import { ScriptedLLM, makeHarness, makeIntent } from './helpers/context.js';
import { buildEngine } from './helpers/engine.js';

const WS = 'C:/workspace';

function planTurn(steps: { title: string; goal?: string; acceptance: { kind: string; params: Record<string, unknown>; description?: string }[] }[]) {
  return { text: JSON.stringify({ steps }) };
}

function writeTurn(path: string, content: string) {
  return { toolCalls: [{ name: 'fs.write', arguments: { path, content } }] };
}

const finishTurn = { text: 'wrote the file' };

function fileExists(path: string) {
  return { kind: 'file-exists', params: { path }, description: `${path} exists` };
}

function failingScript() {
  return [
    planTurn([{ title: 'Write a.txt', goal: 'create a.txt', acceptance: [fileExists('a.txt')] }]),
    writeTurn('b.txt', 'hello'),
    finishTurn,
  ];
}

describe('AgentLoop advise', () => {
  it('emits a human-gated ticket on a failed verdict and leaves the workspace alone', async () => {
    const observed = makeHarness({
      llm: new ScriptedLLM(failingScript()),
      config: { plannerMode: 'full', cognitionMode: 'observe' },
    });
    const advised = makeHarness({
      llm: new ScriptedLLM(failingScript()),
      config: { plannerMode: 'full', cognitionMode: 'advise' },
    });
    const baseline = await buildEngine(observed, { cognition: 'on' }).loop.run(
      makeIntent({ goal: 'create a.txt', expectedPaths: ['a.txt'] }),
    );
    const outcome = await buildEngine(advised, { cognition: 'on' }).loop.run(
      makeIntent({ goal: 'create a.txt', expectedPaths: ['a.txt'] }),
    );

    expect(outcome.status).toBe(baseline.status);
    expect(outcome.stepsCompleted).toBe(baseline.stepsCompleted);
    expect(advised.fs.files.get(`${WS}/b.txt`)).toBe(observed.fs.files.get(`${WS}/b.txt`));
    expect(advised.fs.files.has(`${WS}/a.txt`)).toBe(false);
    expect(observed.events.some((event) => event.type === 'cognition.advice')).toBe(false);
    const advice = advised.events.filter((event) => event.type === 'cognition.advice');
    expect(advice.length).toBeGreaterThan(0);
    expect(advice[0]?.payload).toMatchObject({
      ticket: { disposition: 'pending_human', gate: 'L2' },
    });
    expect(advised.events.some((event) => event.type === 'plan.revised')).toBe(false);
  });

  it('does not advise on a fast plan', async () => {
    const h = makeHarness({
      llm: new ScriptedLLM([
        planTurn([{ title: 'Write a.txt', goal: 'create a.txt', acceptance: [fileExists('a.txt')] }]),
        writeTurn('a.txt', 'hello'),
        finishTurn,
      ]),
      config: { plannerMode: 'fast', cognitionMode: 'advise' },
    });
    const outcome = await buildEngine(h, { cognition: 'on' }).loop.run(
      makeIntent({ goal: 'create a.txt', expectedPaths: ['a.txt'] }),
    );
    expect(outcome.status).toBe('done');
    expect(h.events.some((event) => event.type === 'cognition.advice')).toBe(false);
    expect(h.events.some((event) => event.type === 'cognition.skipped')).toBe(true);
  });
});

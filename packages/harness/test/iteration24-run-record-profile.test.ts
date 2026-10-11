import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { readRunRecord } from '../src/replay/run-record.js';
import { profileCandidates, profileMatchesWorkspace } from '../src/profile/profile-loader.js';
import { ScriptedLLM, makeIntent, makeHarness } from './helpers/context.js';
import { buildEngine } from './helpers/engine.js';

/**
 * Iteration 24 鈥?run record and project profile wired into the real loop.
 *
 * 1. A finished task writes an offline-readable run directory (model, prompts,
 *    context snapshot, tool results) and it reads back.
 * 2. A profile for the current workspace feeds conventions / pitfalls /
 *    verification / forbidden into the planning prompt.
 * 3. A malformed profile never kills the task.
 */
describe('iteration 24 鈥?run record in the real loop', () => {
  it('writes an offline-readable run directory at task end', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'camelia-i24-run-'));
    try {
      const h = makeHarness({
        workspace: 'C:/workspace',
        seed: {},
        config: { runRecordDir: dir, planApproval: 'auto' },
        llm: new ScriptedLLM(makeTurns()),
      });
      const { loop } = buildEngine(h);
      const outcome = await loop.run(makeIntent({ expectedPaths: ['a.txt'] }));

      expect(outcome.status).toBe('done');

      const record = await readRunRecord(path.join(dir, h.ctx.taskId));
      expect(record.model).toBe('scripted-1');
      // The planner call and the executor call both went through the gateway.
      expect(record.prompts.length).toBeGreaterThanOrEqual(2);
      const purposes = record.prompts.map((p) => JSON.parse(p).purpose as string);
      expect(purposes).toContain('plan');
      expect(purposes).toContain('execute');
      // The context snapshot carries the goal slot and at least the assistant turn.
      const context = record.context as { slots: { goal: string }; entries: unknown[] };
      expect(context.slots.goal).toBe('Add a CONTRIBUTING.md file');
      expect(context.entries.length).toBeGreaterThan(0);
      // The executed tool call is in the record.
      const toolCalls = record.toolResults.flat() as Array<{ name?: string }>;
      expect(toolCalls.some((t) => t.name === 'fs.write')).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('survives a missing run-record directory configuration without writing', async () => {
    const h = makeHarness({
      workspace: 'C:/workspace',
      config: { planApproval: 'auto' }, // no runRecordDir
      llm: new ScriptedLLM(makeTurns()),
    });
    const { loop } = buildEngine(h);
    const outcome = await loop.run(makeIntent({ expectedPaths: ['a.txt'] }));
    expect(outcome.status).toBe('done');
  });
});

describe('iteration 24 鈥?project profile feeds planning', () => {
  it('puts profile forbidden rules into the plan prompt', async () => {
    const h = makeHarness({
      workspace: 'C:/workspace',
      seed: {
        'C:/profiles/workspace.yaml': [
          'name: workspace',
          'conventions:',
          '  - Keep keys in ~/.camelia',
          'pitfalls:',
          '  - Empty acceptance can pass',
          'verification:',
          '  - Re-run the gate',
          'forbidden:',
          '  - Do not send telemetry',
        ].join('\n'),
      },
      config: { profileDir: 'C:/profiles', planApproval: 'auto' },
      llm: new ScriptedLLM(makeTurns()),
    });
    const { loop } = buildEngine(h);
    const outcome = await loop.run(makeIntent({ expectedPaths: ['a.txt'] }));
    expect(outcome.status).toBe('done');

    const planCall = h.llm.requests[0]!;
    const system = planCall.messages[0]?.content ?? '';
    expect(system).toContain('Project profile');
    expect(system).toContain('Do not send telemetry');
    expect(system).toContain('Keep keys in ~/.camelia');
    expect(system).toContain('Empty acceptance can pass');
    expect(system).toContain('Re-run the gate');
  });

  it('candidate names cover exact and lowercase workspace basenames', () => {
    expect(profileCandidates('C:/Camelia-Agent')).toEqual([
      'Camelia-Agent.yaml',
      'Camelia-Agent.yml',
      'camelia-agent.yaml',
      'camelia-agent.yml',
    ]);
  });

  it('scan fallback matches a profile authored under the project name', async () => {
    // `~/.camelia/profiles/camelia.yaml` (name: camelia) must match the workspace
    // `Camelia-Agent` — the exact-basename candidates do not hit, so the loader
    // scans the directory and matches on the `name:` field.
    const h = makeHarness({
      workspace: 'C:/Camelia-Agent',
      seed: {
        'C:/profiles/camelia.yaml': 'name: camelia\nforbidden:\n  - Do not send telemetry\n',
      },
      config: { profileDir: 'C:/profiles', planApproval: 'auto' },
      llm: new ScriptedLLM(makeTurns()),
    });
    const { loop } = buildEngine(h);
    const outcome = await loop.run(makeIntent({ expectedPaths: ['a.txt'] }));
    expect(outcome.status).toBe('done');

    const system = h.llm.requests[0]!.messages[0]?.content ?? '';
    expect(system).toContain('Project profile');
    expect(system).toContain('Do not send telemetry');
  });

  it('profileMatchesWorkspace requires a real prefix relationship', () => {
    expect(profileMatchesWorkspace('camelia', 'C:/Camelia-Agent')).toBe(true);
    expect(profileMatchesWorkspace('Camelia', 'C:/Camelia-Agent')).toBe(true);
    expect(profileMatchesWorkspace('workspace', 'C:/workspace')).toBe(true);
    // Too short to be a meaningful match.
    expect(profileMatchesWorkspace('c', 'C:/Camelia-Agent')).toBe(false);
    // Unrelated name.
    expect(profileMatchesWorkspace('other', 'C:/Camelia-Agent')).toBe(false);
  });

  it('a malformed profile never kills the task', async () => {
    const h = makeHarness({
      workspace: 'C:/workspace',
      seed: {
        // `extra:` is outside the profile schema -> parseProjectProfile throws.
        'C:/profiles/workspace.yaml': 'name: workspace\nextra: 1\n',
      },
      config: { profileDir: 'C:/profiles', planApproval: 'auto' },
      llm: new ScriptedLLM(makeTurns()),
    });
    const { loop } = buildEngine(h);
    const outcome = await loop.run(makeIntent({ expectedPaths: ['a.txt'] }));

    expect(outcome.status).toBe('done');
    // The malformed profile must not have leaked into the plan prompt.
    const planCall = h.llm.requests[0]!;
    const system = planCall.messages[0]?.content ?? '';
    expect(system).not.toContain('Project profile');
  });

  it('a missing profile leaves planning untouched', async () => {
    const h = makeHarness({
      workspace: 'C:/workspace',
      config: { profileDir: 'C:/profiles', planApproval: 'auto' },
      llm: new ScriptedLLM(makeTurns()),
    });
    const { loop } = buildEngine(h);
    const outcome = await loop.run(makeIntent({ expectedPaths: ['a.txt'] }));
    expect(outcome.status).toBe('done');
    const system = h.llm.requests[0]?.messages[0]?.content ?? '';
    expect(system).not.toContain('Project profile');
  });
});

/** A three-turn script: plan 鈫?write a.txt via tool call 鈫?done. */
function makeTurns() {
  return [
    {
      text: JSON.stringify({
        steps: [
          {
            title: 'write a.txt',
            goal: 'create a.txt containing hello',
            deps: [],
            acceptance: [{ description: 'a.txt exists', kind: 'file-exists', params: { path: 'a.txt' } }],
          },
        ],
      }),
    },
    { text: '', toolCalls: [{ name: 'fs.write', arguments: { path: 'a.txt', content: 'hello' } }] },
    { text: 'wrote a.txt' },
  ];
}

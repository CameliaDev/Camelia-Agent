/**
 * Term team orchestration.
 *
 * The coordinator must produce workers, each worker must be assignable from the
 * catalog, and the run is done only after a sub-agent actually returns ok.
 * @module
 */
import { describe, expect, it } from 'vitest';

import type { ModelInfo, SubAgentReport } from '@camelia/core';
import { TaskStateMachine, llmContentText } from '@camelia/core';

import { assignRoleModel } from '../src/team/assign-roles.js';
import { applyVisionHint, goalNeedsVision, parseTeamWorkers } from '../src/team/plan.js';
import { TeamOrchestrator } from '../src/team/TeamOrchestrator.js';
import { SubAgentOrchestrator, type SubAgentSpec } from '../src/subagent/SubAgentOrchestrator.js';
import { ScriptedLLM, makeHarness, makeIntent } from './helpers/context.js';
import { buildEngine } from './helpers/engine.js';

const blind: ModelInfo = {
  id: 'qwen-plus',
  providerId: 'aliyun',
  label: 'qwen-plus',
  contextWindow: 131_072,
  supportsTools: true,
  supportsJson: true,
  supportsVision: false,
  capabilitySource: { vision: 'inferred', context: 'inferred', tools: 'provider' },
};

const eyes: ModelInfo = {
  id: 'qwen-vl-plus',
  providerId: 'aliyun',
  label: 'qwen-vl-plus',
  contextWindow: 32_000,
  supportsTools: true,
  supportsJson: true,
  supportsVision: true,
  capabilitySource: { vision: 'advertised', context: 'advertised', tools: 'advertised' },
};

const unknownWindow: ModelInfo = {
  id: 'acme-custom',
  providerId: 'acme',
  label: 'acme-custom',
  contextWindow: 128_000,
  supportsTools: true,
  supportsJson: true,
  supportsVision: false,
  capabilitySource: { vision: 'unknown', context: 'default', tools: 'provider' },
};

function report(spec: SubAgentSpec, status: SubAgentReport['status']): SubAgentReport {
  return {
    id: 'runner-id',
    parentTaskId: 'parent',
    goal: spec.goal,
    status,
    summary: status === 'ok' ? 'done the work' : 'worker exploded',
    artifacts: [],
    verdicts: [],
    tokensUsed: 3,
    startedAt: 1,
    endedAt: 2,
  };
}

describe('assignRoleModel', () => {
  it('requires a vision model when the role must see', () => {
    const pick = assignRoleModel([blind, eyes], { requireVision: true }, blind.id);
    expect(pick).toEqual({
      ok: true,
      modelId: 'qwen-vl-plus',
      reason: expect.stringContaining('vision required'),
    });
  });

  it('does not treat a default context window as enough for a minimum', () => {
    const pick = assignRoleModel([unknownWindow, blind], { minContextTokens: 100_000 });
    expect(pick.ok).toBe(true);
    if (pick.ok) expect(pick.modelId).toBe('qwen-plus');
    expect(assignRoleModel([unknownWindow], { minContextTokens: 100_000 }).ok).toBe(false);
  });

  it('fails closed when nothing qualifies', () => {
    const pick = assignRoleModel([blind], { requireVision: true });
    expect(pick.ok).toBe(false);
    if (!pick.ok) expect(pick.reason).toContain('vision');
  });
});

describe('parseTeamWorkers', () => {
  it('rejects prose and empty lists', () => {
    expect(parseTeamWorkers('I will just do it myself').ok).toBe(false);
    expect(parseTeamWorkers('{"workers":[]}').ok).toBe(false);
    expect(parseTeamWorkers('{"workers":[{"role":"writer","goal":"write notes"}]}').ok).toBe(true);
  });

  it('marks the first worker as vision when the goal asks to look at an image', () => {
    expect(goalNeedsVision('请看这张截图并总结')).toBe(true);
    const parsed = parseTeamWorkers('{"workers":[{"goal":"summarise the page"}]}');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const hinted = applyVisionHint('请看这张截图并总结', parsed.workers);
    expect(hinted[0]?.requireVision).toBe(true);
  });
});

describe('TeamOrchestrator', () => {
  function harnessTeam(plan: string, status: SubAgentReport['status'] = 'ok') {
    const h = makeHarness();
    const calls: SubAgentSpec[] = [];
    const machine = new TaskStateMachine('planning');
    const subAgents = new SubAgentOrchestrator(
      async (spec) => {
        calls.push(spec);
        return report(spec, status);
      },
      h.ctx,
      h.ctx.config,
    );
    const team = new TeamOrchestrator({
      ctx: h.ctx,
      subAgents,
      catalog: [blind, eyes],
      preferredModel: blind.id,
      planText: async () => plan,
      transition: (to, reason) => {
        const result = machine.transition(to, reason);
        if (!result.ok) throw new Error(`${result.from} -> ${to}: ${result.error}`);
      },
      approve: async (ready) => {
        const result = machine.transition('awaiting-approval', 'gate');
        if (!result.ok) throw new Error(result.error);
        return { ok: true, plan: ready };
      },
    });
    return { h, calls, team, machine };
  }

  it('spawns the assigned worker and finishes only after an ok report', async () => {
    const { h, calls, team, machine } = harnessTeam(
      JSON.stringify({ workers: [{ role: 'writer', goal: 'write the notes', requireTools: true }] }),
    );
    const outcome = await team.run('write the notes');
    expect(outcome.status).toBe('done');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.model).toBe('qwen-plus');
    expect(calls[0]?.role).toBe('writer');
    expect(machine.current).toBe('delivering');
    expect(h.events.map((event) => event.type)).toEqual(
      expect.arrayContaining(['plan.started', 'plan.ready', 'subagent.spawned', 'subagent.finished', 'verify.started', 'verify.result']),
    );
    expect(h.events.some((event) => event.type === 'task.completed')).toBe(false);
  });

  it('does not spawn or finish when the coordinator returns no workers', async () => {
    const { h, calls, team } = harnessTeam('not json');
    const outcome = await team.run('do something');
    expect(outcome.status).toBe('failed');
    expect(outcome.workersRan).toBe(0);
    expect(calls).toHaveLength(0);
    expect(h.events.some((event) => event.type === 'subagent.spawned')).toBe(false);
  });

  it('does not claim done when every worker errors', async () => {
    const { calls, team, machine } = harnessTeam(
      JSON.stringify({ workers: [{ role: 'writer', goal: 'write the notes' }] }),
      'error',
    );
    const outcome = await team.run('write the notes');
    expect(outcome.status).toBe('failed');
    expect(outcome.workersRan).toBe(1);
    expect(calls).toHaveLength(1);
    expect(machine.current).toBe('verifying');
    expect(outcome.reason).toContain('none succeeded');
  });

  it('does not spawn a blind model for a vision worker', async () => {
    const h = makeHarness();
    const calls: SubAgentSpec[] = [];
    const machine = new TaskStateMachine('planning');
    const subAgents = new SubAgentOrchestrator(
      async (spec) => {
        calls.push(spec);
        return report(spec, 'ok');
      },
      h.ctx,
      h.ctx.config,
    );
    const team = new TeamOrchestrator({
      ctx: h.ctx,
      subAgents,
      catalog: [blind],
      planText: async () => JSON.stringify({
        workers: [{ role: 'reader', goal: 'read the screenshot', requireVision: true }],
      }),
      transition: (to, reason) => {
        const result = machine.transition(to, reason);
        if (!result.ok) throw new Error(result.error);
      },
      approve: async (ready) => ({ ok: true, plan: ready }),
    });
    const outcome = await team.run('read the screenshot');
    expect(outcome.status).toBe('failed');
    expect(outcome.reason).toContain('vision');
    expect(calls).toHaveLength(0);
  });
});

describe('AgentLoop.runTeam', () => {
  it('runs a coordinator and a real sub-agent, then completes', async () => {
    let writes = 0;
    const llm = new ScriptedLLM((request) => {
      const content = request.messages[0]?.content;
      const system = content === undefined ? '' : llmContentText(content);
      if (system.includes('team coordinator')) {
        return {
          text: JSON.stringify({
            workers: [{ role: 'writer', goal: 'create notes.txt', requireTools: true, focusPaths: ['notes.txt'] }],
          }),
        };
      }
      if (system.includes('You are the PLANNER')) {
        return {
          text: JSON.stringify({
            steps: [{
              title: 'Write notes',
              goal: 'create notes.txt',
              acceptance: [{ description: 'file exists', kind: 'file-exists', params: { path: 'notes.txt' } }],
            }],
          }),
        };
      }
      if (system.includes('You are the EXECUTOR')) {
        writes += 1;
        if (writes === 1) {
          return { toolCalls: [{ name: 'fs.write', arguments: { path: 'notes.txt', content: 'shipped' } }] };
        }
        return { text: 'wrote notes.txt' };
      }
      return { text: 'ok' };
    });
    const h = makeHarness({ llm, workspace: 'C:/workspace' });
    const { loop } = buildEngine(h);
    const catalog: ModelInfo[] = [{
      id: 'scripted-1',
      providerId: 'scripted',
      label: 'Scripted',
      contextWindow: 128_000,
      supportsTools: true,
      supportsJson: true,
      supportsVision: false,
      capabilitySource: { vision: 'unknown', context: 'inferred', tools: 'provider' },
    }];
    const outcome = await loop.runTeam(makeIntent({ goal: 'create notes.txt', expectedPaths: ['notes.txt'] }), catalog);
    expect(outcome.status).toBe('done');
    expect(h.fs.files.get('C:/workspace/notes.txt')).toBe('shipped');
    expect(h.events.map((event) => event.type)).toContain('subagent.spawned');
    expect(h.events.map((event) => event.type)).toContain('subagent.finished');
    expect(h.events.map((event) => event.type)).toContain('task.completed');
    expect(h.events.filter((event) => event.type === 'task.failed')).toHaveLength(0);
    const spawned = h.events.find((event) => event.type === 'subagent.spawned');
    expect(spawned?.payload).toMatchObject({ model: 'scripted-1', role: 'writer' });
  });

  it('fails without spawning when the coordinator does not name a worker', async () => {
    const llm = new ScriptedLLM([{ text: 'I will handle it personally.' }]);
    const h = makeHarness({ llm });
    const { loop } = buildEngine(h);
    const outcome = await loop.runTeam(makeIntent({ goal: 'ship the notes' }));
    expect(outcome.status).toBe('failed');
    expect(outcome.reason).toContain('workers');
    expect(h.events.some((event) => event.type === 'subagent.spawned')).toBe(false);
    expect(h.events.some((event) => event.type === 'task.completed')).toBe(false);
    expect(h.events.some((event) => event.type === 'task.failed')).toBe(true);
  });
});

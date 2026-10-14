/**
 * Main AI delegates through the coordinator JSON, the token gate, and
 * TeamOrchestrator when one is present. Shared memory is part of the prompt.
 * @module
 */

import { describe, expect, it } from 'vitest';

import type { ModelInfo, SubAgentReport } from '@camelia/core';
import { TaskStateMachine } from '@camelia/core';

import { SubAgentOrchestrator, type SubAgentSpec } from '../src/subagent/SubAgentOrchestrator.js';
import { TeamOrchestrator } from '../src/team/TeamOrchestrator.js';
import { delegateWork } from '../src/work/WorkDelegation.js';
import { WorkTokenGate } from '../src/work/WorkTokenGate.js';
import { makeHarness } from './helpers/context.js';

const model: ModelInfo = {
  id: 'qwen-plus',
  providerId: 'aliyun',
  label: 'qwen-plus',
  contextWindow: 131_072,
  supportsTools: true,
  supportsJson: true,
  supportsVision: false,
  capabilitySource: { vision: 'inferred', context: 'inferred', tools: 'provider' },
};

function report(spec: SubAgentSpec): SubAgentReport {
  return {
    id: 'runner',
    parentTaskId: 'parent',
    goal: spec.goal,
    status: 'ok',
    summary: 'wrote the notes',
    artifacts: [],
    verdicts: [],
    tokensUsed: 1,
    startedAt: 1,
    endedAt: 2,
  };
}

describe('delegateWork', () => {
  it('reuses TeamOrchestrator and recalls shared memory into the coordinator prompt', async () => {
    const h = makeHarness();
    const calls: SubAgentSpec[] = [];
    const machine = new TaskStateMachine('planning');
    const subAgents = new SubAgentOrchestrator(
      async (spec) => {
        calls.push(spec);
        return report(spec);
      },
      h.ctx,
      h.ctx.config,
    );
    const team = new TeamOrchestrator({
      ctx: h.ctx,
      subAgents,
      catalog: [model],
      preferredModel: model.id,
      planText: async () => '',
      transition: (to, reason) => {
        const result = machine.transition(to, reason);
        if (!result.ok) throw new Error(result.error);
      },
      approve: async (plan) => ({ ok: true, plan }),
    });
    const prompts: string[] = [];
    const gate = new WorkTokenGate();
    const tokens = new Map();
    const outcome = await delegateWork({
      goal: 'rename the notes',
      constraints: ['keep the title'],
      memory: '- the file lives in notes/',
      planText: async (prompt) => {
        prompts.push(prompt);
        return JSON.stringify({
          workers: [{ role: 'writer', goal: 'rename notes/a.md', requireTools: true, focusPaths: ['notes'] }],
        });
      },
      think: async () => ({
        goals: ['rename notes/a.md'],
        constraints: ['keep the title'],
        plan: ['edit the heading'],
      }),
      gate,
      tokens,
      allowedTools: ['fs.read', 'fs.write'],
      team,
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.workers).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.role).toBe('writer');
    expect(prompts[0]).toContain('Shared memory');
    expect(prompts[0]).toContain('notes/');
    expect(prompts[0]).toContain('keep the title');
    expect(machine.current).toBe('planning');
    expect(h.events.some((event) => event.type === 'plan.ready' || event.type === 'plan.started')).toBe(false);
    expect(tokens.size).toBe(1);
  });

  it('does not spawn a sub-AI that skipped the thought', async () => {
    const h = makeHarness();
    const calls: SubAgentSpec[] = [];
    const subAgents = new SubAgentOrchestrator(
      async (spec) => {
        calls.push(spec);
        return report(spec);
      },
      h.ctx,
      h.ctx.config,
    );
    const team = new TeamOrchestrator({
      ctx: h.ctx,
      subAgents,
      catalog: [model],
      planText: async () => '',
      transition: () => undefined,
      approve: async (plan) => ({ ok: true, plan }),
    });
    const outcome = await delegateWork({
      goal: 'rename the notes',
      constraints: [],
      memory: '',
      planText: async () => JSON.stringify({ workers: [{ role: 'writer', goal: 'rename notes/a.md' }] }),
      think: async () => undefined,
      gate: new WorkTokenGate(),
      tokens: new Map(),
      allowedTools: ['*'],
      team,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.handedBack).toBe(1);
    expect(calls).toHaveLength(0);
    expect(outcome.summary).toMatch(/short plan/);
  });
});

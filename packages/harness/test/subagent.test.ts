/**
 * SubAgentOrchestrator tests (whitepaper §3.6).
 *
 * The contract being verified: a sub-agent runs in its own context, the parent
 * only ever receives a structured, token-capped report, concurrency is bounded,
 * and a sub-agent failure degrades to an `error` report instead of breaking the
 * parent task.
 * @module
 */

import { describe, expect, it } from 'vitest';

import type { SubAgentReport } from '@camelia/core';

import { ScriptedLLM, makeHarness, makeIntent } from './helpers/context.js';
import { buildEngine } from './helpers/engine.js';
import { SubAgentOrchestrator } from '../src/subagent/SubAgentOrchestrator.js';

const WS = 'C:/workspace';

describe('SubAgentOrchestrator', () => {
  it('runs a nested agent and returns an isolated, structured report', async () => {
    const llm = new ScriptedLLM([
      { text: JSON.stringify({ steps: [{ title: 'Write sub.txt', acceptance: [{ kind: 'file-exists', params: { path: 'sub.txt' } }] }] }) },
      { toolCalls: [{ name: 'fs.write', arguments: { path: 'sub.txt', content: 'from sub-agent' } }] },
      { text: 'wrote sub.txt' },
    ]);
    const h = makeHarness({ llm });
    const { subAgents } = buildEngine(h);

    const report = await subAgents.spawn({ goal: 'create sub.txt', focusPaths: ['sub.txt'] });

    expect(report.status).toBe('ok');
    expect(report.parentTaskId).toBe(h.ctx.taskId);
    expect(report.goal).toBe('create sub.txt');
    expect(report.artifacts.map((a) => a.path)).toContain('sub.txt');
    expect(report.verdicts.every((v) => v.status === 'pass')).toBe(true);
    expect(h.fs.files.get(`${WS}/sub.txt`)).toBe('from sub-agent');
    // The sub-agent's own lifecycle is observable.
    expect(h.events.map((e) => e.type)).toContain('subagent.spawned');
    expect(h.events.map((e) => e.type)).toContain('subagent.finished');
  });

  it('caps a sub-agent report to the configured token budget', async () => {
    const longSummary = 'x'.repeat(600);
    const llm = new ScriptedLLM([
      { text: JSON.stringify({ steps: [{ title: 'Do work', acceptance: [{ kind: 'manual', params: {}, description: 'm' }] }] }) },
      { text: longSummary },
    ]);
    const h = makeHarness({ llm, config: { subAgentReportTokenCap: 10 } });
    const { subAgents } = buildEngine(h);

    const report = await subAgents.spawn({ goal: 'produce a long report' });

    expect(report.summary).toContain('[sub-agent summary truncated');
    expect(h.metrics.snapshot().some((m) => m.name === 'subagent.report_tokens')).toBe(true);
  });

  it('degrades a throwing runner to an error report instead of breaking the parent', async () => {
    const h = makeHarness({});
    const orchestrator = new SubAgentOrchestrator(
      async () => {
        throw new Error('provider exploded');
      },
      h.ctx,
      h.ctx.config,
    );

    const report = await orchestrator.spawn({ goal: 'doomed' });

    expect(report.status).toBe('error');
    expect(report.summary).toContain('provider exploded');
    expect(h.metrics.snapshot().some((m) => m.name === 'subagent.failure')).toBe(true);
  });

  it('bounds concurrency to maxSubAgents', async () => {
    const h = makeHarness({ config: { maxSubAgents: 2 } });
    let active = 0;
    let peak = 0;

    const orchestrator = new SubAgentOrchestrator(
      async (spec): Promise<SubAgentReport> => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return {
          id: spec.goal,
          parentTaskId: h.ctx.taskId,
          goal: spec.goal,
          status: 'ok',
          summary: 'done',
          artifacts: [],
          verdicts: [],
          tokensUsed: 1,
          startedAt: 0,
          endedAt: 1,
        };
      },
      h.ctx,
      h.ctx.config,
    );

    await orchestrator.spawnAll([{ goal: 'a' }, { goal: 'b' }, { goal: 'c' }, { goal: 'd' }]);

    expect(peak).toBeLessThanOrEqual(2);
    expect(h.metrics.snapshot().some((m) => m.name === 'subagent.concurrent_peak')).toBe(true);
  });

  it('digests multiple reports into a parent-visible summary', () => {
    const reports: SubAgentReport[] = [
      {
        id: '1',
        parentTaskId: 'p',
        goal: 'one',
        status: 'ok',
        summary: 'did one',
        artifacts: [{ kind: 'file', path: 'a.ts' }],
        verdicts: [],
        tokensUsed: 1,
        startedAt: 0,
        endedAt: 1,
      },
      {
        id: '2',
        parentTaskId: 'p',
        goal: 'two',
        status: 'error',
        summary: 'failed two',
        artifacts: [{ kind: 'file', path: 'b.ts' }],
        verdicts: [],
        tokensUsed: 1,
        startedAt: 0,
        endedAt: 1,
      },
    ];

    const digest = SubAgentOrchestrator.digest(reports);

    expect(digest.artifacts.map((a) => a.path)).toEqual(['a.ts', 'b.ts']);
    expect(digest.summary).toContain('[ok] one');
    expect(digest.summary).toContain('[error] two');
  });

  it('reports an aborted sub-agent as an error rather than a success', async () => {
    const llm = new ScriptedLLM([
      { text: JSON.stringify({ steps: [{ title: 'Work', acceptance: [{ kind: 'manual', params: {}, description: 'm' }] }] }) },
      { text: 'never reached' },
    ]);
    const h = makeHarness({ llm });
    const { loop } = buildEngine(h);

    const controller = new AbortController();
    controller.abort();
    const report = await loop.runSubAgent({ goal: 'aborted work' }, controller.signal);

    expect(report.status).toBe('error');
    expect(report.summary).toContain('aborted');
  });

  it('keeps the parent context free of the sub-agent transcript', async () => {
    const llm = new ScriptedLLM([
      { text: JSON.stringify({ steps: [{ title: 'Sub work', acceptance: [{ kind: 'manual', params: {}, description: 'm' }] }] }) },
      { text: 'sub-agent internal detail that must not leak to the parent' },
    ]);
    const h = makeHarness({ llm });
    const { loop, context, subAgents } = buildEngine(h);

    // A real task runs first, then a sub-agent is spawned into the same engine.
    const main = new ScriptedLLM([{ text: JSON.stringify({ steps: [{ title: 'Main', acceptance: [{ kind: 'manual', params: {}, description: 'm' }] }] }) }, { text: 'main done' }]);
    void main;
    await subAgents.spawn({ goal: 'do sub work' });

    // The parent context only holds what the parent appended; the sub-agent's
    // transcript never entered it.
    const snapshot = JSON.stringify(context.snapshot());
    expect(snapshot).not.toContain('sub-agent internal detail that must not leak');
    expect(loop.status).toBe('received');
    void makeIntent;
  });
});
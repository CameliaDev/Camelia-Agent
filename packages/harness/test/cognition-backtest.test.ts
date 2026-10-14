/**
 * Phase 0 replay. The gate result is reported, not required: a FAIL means the
 * signature needs a redesign, and the tooling still has to run.
 * @module
 */

import { describe, expect, it } from 'vitest';

import { runCognitionBacktest, type ReplayEvent } from '../src/cognition/backtest.js';
import { syntheticCognitionCorpus } from '../src/cognition/synthetic-corpus.js';

describe('cognition backtest', () => {
  it('promotes a repeated situation off the prior once minLevelSamples is met', () => {
    const events = fourReads();
    const report = runCognitionBacktest(events, { sourceLabel: 'unit' });
    expect(report.steps).toBe(4);
    expect(report.coverage).toBe(1);
    expect(report.priorSurpriseCount).toBe(0);
    const levels = report.backoffDistribution.map((row) => row.level);
    expect(levels).toContain(-1);
    expect(levels).toContain(3);
  });

  it('scores the synthetic corpus without surprising on priors', () => {
    const events = syntheticCognitionCorpus();
    const once = runCognitionBacktest(events, { sourceLabel: 'synthetic' });
    const twice = runCognitionBacktest(events, { sourceLabel: 'synthetic' });
    expect(twice).toEqual(once);
    expect(once.steps).toBeGreaterThan(0);
    expect(once.l2Plus.count).toBeGreaterThan(0);
    expect(once.priorOnL2Plus.count).toBe(once.l2Plus.count);
    expect(once.priorSurpriseCount).toBe(0);
    expect(once.skippedSensors).toEqual(['cost-usd', 'failure-mode']);
    const pass = once.l2Plus.count > 0 && once.delta >= once.gateThreshold;
    expect(once.gate).toBe(pass ? 'PASS' : 'FAIL');
    expect(once.byLevel.every((row) => row.meanResidual >= 0 && row.meanResidual <= 1)).toBe(true);
  });
});

function fourReads(): ReplayEvent[] {
  const events: ReplayEvent[] = [];
  let seq = 0;
  let ts = 1_000;
  const push = (type: string, payload: unknown, taskId?: string): void => {
    seq += 1;
    ts += 10;
    events.push({ seq, sessionId: 'ses', taskId, type, payload, traceId: 'tr', ts });
  };
  push('provider.capabilities', {
    providerId: 'synthetic',
    capabilities: {
      supportsTools: true,
      textToolCalls: false,
      supportsJson: true,
      supportsStreaming: true,
      maxContextWindow: 1024,
      quality: 0.7,
    },
  });
  for (let index = 0; index < 4; index += 1) {
    const taskId = `tsk_${index}`;
    const stepId = `stp_${index}`;
    const step = {
      id: stepId,
      taskId,
      idx: 0,
      title: 'Read src/a.ts',
      goal: 'Read the file',
      status: 'pending',
      acceptance: [{ id: 'a', description: 'src/a.ts', kind: 'file-exists', params: { path: 'src/a.ts' } }],
      weight: 1,
      deps: [],
    };
    push('plan.ready', { plan: { id: `plan_${index}`, taskId, steps: [step], mode: 'full', revision: 1, createdAt: ts } }, taskId);
    push('step.started', { step: { ...step, status: 'running' } }, taskId);
    push(
      'tool.requested',
      { call: { id: `c_${index}`, stepId, taskId, name: 'fs.read', input: { path: 'src/a.ts' }, status: 'running' } },
      taskId,
    );
    push(
      'tool.finished',
      {
        call: {
          id: `c_${index}`,
          stepId,
          taskId,
          name: 'fs.read',
          input: { path: 'src/a.ts' },
          status: 'ok',
          durationMs: 100,
        },
      },
      taskId,
    );
    push(
      'verify.result',
      { verdict: { id: `v_${index}`, stepId, taskId, status: 'pass', evidence: [], reason: 'ok', createdAt: ts } },
      taskId,
    );
    push(
      'step.completed',
      { step: { ...step, status: 'done' }, result: { stepId, status: 'ok', toolCalls: [], summary: 'ok', artifacts: [{ kind: 'file', path: 'src/a.ts' }] }, score: 1 },
      taskId,
    );
  }
  return events;
}

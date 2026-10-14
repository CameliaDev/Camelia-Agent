/**
 * Phase 3 — observe-only wiring.
 *
 * Predictions and residuals are recorded. A fast plan is skipped. A policy
 * that asks for a different plan is recorded and not applied, so the task
 * outcome matches a run with no cognition port.
 */
import { describe, expect, it } from 'vitest';

import type { CognitionPort, CognitiveAction, Plan, PredictionContext } from '@camelia/core';

import type { CognitivePolicy } from '../src/cognition/CognitivePolicy.js';
import { CognitionService } from '../src/cognition/CognitionService.js';
import { buildSignature } from '../src/cognition/signature.js';
import { ScriptedLLM, acceptancePoint, makeHarness, makeIntent, makeStep, MemoryStore } from './helpers/context.js';
import { buildEngine } from './helpers/engine.js';

const WS = 'C:/workspace';

interface RawStepSpec {
  title: string;
  goal?: string;
  acceptance: { kind: string; params: Record<string, unknown>; description?: string }[];
}

function planTurn(steps: RawStepSpec[]): { text: string } {
  return { text: JSON.stringify({ steps }) };
}

function writeTurn(path: string, content: string) {
  return { toolCalls: [{ name: 'fs.write', arguments: { path, content } }] };
}

const finishTurn = { text: 'wrote the file' };

function fileExists(path: string): RawStepSpec['acceptance'][number] {
  return { kind: 'file-exists', params: { path }, description: `${path} exists` };
}

function script() {
  return [
    planTurn([{ title: 'Write a.txt', goal: 'create a.txt', acceptance: [fileExists('a.txt')] }]),
    writeTurn('a.txt', 'hello'),
    finishTurn,
  ];
}

class SplitPolicy implements CognitivePolicy {
  beforeStep(): CognitiveAction {
    return { kind: 'split-step', stepId: 'step', reason: 'predicted wide' };
  }

  afterResidual(): CognitiveAction {
    return { kind: 'reverify', stepId: 'step', reason: 'surprised pass' };
  }
}

const boom: CognitionPort = {
  async predict() {
    throw new Error('predict exploded');
  },
  async observe() {
    throw new Error('observe exploded');
  },
  async competence() {
    throw new Error('competence exploded');
  },
  async mostUncertain() {
    return [];
  },
};

describe('CognitionService', () => {
  it('reloads situation stats and keeps prior residuals unsurprising', async () => {
    const store = new MemoryStore();
    const step = makeStep({
      idx: 0,
      title: 'Edit src/a.ts',
      goal: 'edit the file',
      acceptance: [acceptancePoint('file-exists', { path: 'src/a.ts' })],
    });
    const plan: Plan = {
      id: 'plan-1',
      taskId: step.taskId,
      steps: [step],
      mode: 'full',
      revision: 0,
      createdAt: 0,
    };
    const signature = buildSignature({
      title: step.title,
      goal: step.goal,
      acceptancePaths: ['src/a.ts'],
      capability: 'tool-calling',
      inDegree: 0,
    });
    const caps = {
      supportsTools: true,
      supportsJson: true,
      supportsStreaming: true,
      maxContextWindow: 1000,
      quality: 0.4,
    };
    const context = (now: number): PredictionContext => ({
      taskId: step.taskId,
      sessionId: 'ses',
      workspace: WS,
      stepId: step.id,
      capabilities: caps,
      model: 'm',
      step,
      plan,
      now,
    });
    const first = new CognitionService({ store, minLevelSamples: 3, minSamples: 8 });
    for (let i = 0; i < 3; i += 1) {
      const predicted = await first.predict({ kind: 'verdict', stepId: step.id }, signature, context(i));
      expect(predicted?.source).toBe('prior');
      const residual = await first.observe(
        { kind: 'verdict', stepId: step.id },
        { kind: 'categorical', label: 'pass' },
        context(i + 1),
      );
      expect(residual?.surprise).toBe(false);
      expect(residual?.threshold).toBeNull();
    }

    const reloaded = new CognitionService({ store, minLevelSamples: 3, minSamples: 8 });
    const fourth = await reloaded.predict({ kind: 'verdict', stepId: step.id }, signature, context(10));
    expect(fourth?.source).toBe('empirical-backoff');
    expect(fourth?.level).toBeGreaterThanOrEqual(2);
    const scored = await reloaded.observe(
      { kind: 'verdict', stepId: step.id },
      { kind: 'categorical', label: 'fail' },
      context(11),
    );
    expect(scored?.surprise).toBe(false);
    expect(scored?.score).toBeGreaterThan(0);
  });
});

describe('AgentLoop cognition — observe only', () => {
  it('skips fast plans and still completes the task', async () => {
    const h = makeHarness({ llm: new ScriptedLLM(script()) });
    const { loop } = buildEngine(h, { cognition: 'on' });
    const outcome = await loop.run(makeIntent({ goal: 'create a.txt', expectedPaths: ['a.txt'] }));

    expect(outcome.status).toBe('done');
    expect(h.fs.files.get(`${WS}/a.txt`)).toBe('hello');
    expect(h.events.some((event) => event.type === 'cognition.skipped')).toBe(true);
    const skip = h.events.find((event) => event.type === 'cognition.skipped');
    expect(skip?.payload).toMatchObject({ reason: 'fast-path' });
    expect(h.events.some((event) => event.type === 'cognition.predicted')).toBe(false);
    expect(h.store.predictions).toHaveLength(0);
  });

  it('records predictions and residuals on a full plan without changing the outcome', async () => {
    const bare = makeHarness({
      llm: new ScriptedLLM(script()),
      config: { plannerMode: 'full' },
    });
    const watched = makeHarness({
      llm: new ScriptedLLM(script()),
      config: { plannerMode: 'full' },
    });
    const baseline = await buildEngine(bare).loop.run(makeIntent({ goal: 'create a.txt', expectedPaths: ['a.txt'] }));
    const outcome = await buildEngine(watched, { cognition: 'on' }).loop.run(
      makeIntent({ goal: 'create a.txt', expectedPaths: ['a.txt'] }),
    );

    expect(outcome.status).toBe(baseline.status);
    expect(outcome.stepsCompleted).toBe(baseline.stepsCompleted);
    expect(outcome.stepsTotal).toBe(baseline.stepsTotal);
    expect(outcome.verdicts.map((verdict) => verdict.status)).toEqual(baseline.verdicts.map((verdict) => verdict.status));
    expect(watched.fs.files.get(`${WS}/a.txt`)).toBe(bare.fs.files.get(`${WS}/a.txt`));
    expect(bare.events.some((event) => event.type.startsWith('cognition.'))).toBe(false);

    const predicted = watched.events.filter((event) => event.type === 'cognition.predicted');
    const scored = watched.events.filter((event) => event.type === 'cognition.scored');
    expect(predicted.length).toBeGreaterThan(0);
    expect(scored.length).toBeGreaterThan(0);
    expect(watched.store.predictions.length).toBe(predicted.length);
    expect(watched.store.residuals.length).toBe(scored.length);
    expect(watched.store.residuals.every((residual) => residual.surprise === false)).toBe(true);
    expect(watched.store.situationStats.some((stat) => stat.n > 0)).toBe(true);
    expect(watched.events.some((event) => event.type === 'cognition.surprised')).toBe(false);
    expect(outcome.verdicts).toHaveLength(1);
  });

  it('does not apply a non-proceed policy', async () => {
    const h = makeHarness({
      llm: new ScriptedLLM(script()),
      config: { plannerMode: 'full' },
    });
    const { loop } = buildEngine(h, { cognition: 'on', cognitivePolicy: new SplitPolicy() });
    const outcome = await loop.run(makeIntent({ goal: 'create a.txt', expectedPaths: ['a.txt'] }));

    expect(outcome.status).toBe('done');
    expect(outcome.stepsTotal).toBe(1);
    expect(outcome.verdicts).toHaveLength(1);
    expect(h.events.some((event) => event.type === 'cognition.skipped' && (event.payload as { reason: string }).reason === 'action-deferred')).toBe(true);
    expect(h.events.some((event) => event.type === 'plan.revised')).toBe(false);
  });

  it('finishes the task when the port throws', async () => {
    const h = makeHarness({ llm: new ScriptedLLM(script()), config: { plannerMode: 'full' } });
    const { loop } = buildEngine(h, { cognition: boom });
    const outcome = await loop.run(makeIntent({ goal: 'create a.txt', expectedPaths: ['a.txt'] }));
    expect(outcome.status).toBe('done');
    expect(h.fs.files.get(`${WS}/a.txt`)).toBe('hello');
    expect(h.store.predictions).toHaveLength(0);
  });

  it('emits mode-off and writes nothing when the mode is off', async () => {
    const h = makeHarness({
      llm: new ScriptedLLM(script()),
      config: { plannerMode: 'full', cognitionMode: 'off' },
    });
    const { loop } = buildEngine(h, { cognition: 'on' });
    const outcome = await loop.run(makeIntent({ goal: 'create a.txt', expectedPaths: ['a.txt'] }));
    expect(outcome.status).toBe('done');
    expect(h.events.filter((event) => event.type === 'cognition.skipped').map((event) => event.payload)).toEqual([
      { reason: 'mode-off', detail: 'CognitionMode is off' },
    ]);
    expect(h.store.predictions).toHaveLength(0);
  });
});

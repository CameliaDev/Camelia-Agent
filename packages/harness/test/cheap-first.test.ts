import { describe, expect, it } from 'vitest';

import { DIFFICULTY_THRESHOLD, difficultyScore, modelForAttempt } from '../src/routing/cheap-first.js';

const models = { decision: 'decision', grunt: 'grunt' };

describe('cheap-first routing', () => {
  it('starts a hard step on the decision model', () => {
    const score = difficultyScore({ weight: 5, inDegree: 3, fileCount: 4, historicalFailures: 3 });
    expect(score).toBeGreaterThanOrEqual(DIFFICULTY_THRESHOLD);
    expect(modelForAttempt(0, models, score, false).model).toBe('decision');
  });

  it('keeps an easy first attempt on the grunt model, then escalates', () => {
    const score = difficultyScore({ weight: 1, inDegree: 0, fileCount: 1, historicalFailures: 0 });
    expect(score).toBeLessThan(DIFFICULTY_THRESHOLD);
    expect(modelForAttempt(0, models, score, false)).toMatchObject({ model: 'grunt', reflect: false });
    expect(modelForAttempt(1, models, score, false)).toMatchObject({ model: 'decision', reflect: false });
    expect(modelForAttempt(2, models, score, false)).toMatchObject({ model: 'decision', reflect: true });
  });

  it('stays on the grunt model once the task cost ceiling is hit', () => {
    const choice = modelForAttempt(2, models, 0.9, true);
    expect(choice.model).toBe('grunt');
    expect(choice.reason).toMatch(/maxCostPerTask/);
  });
});

import { describe, expect, it } from 'vitest';

import type { ClarifiedIntent } from '@camelia/core';

import { effortInstruction, withEffort } from '../src/runtime/effort.js';

const intent = (): ClarifiedIntent => ({
  goal: 'do the thing',
  assumptions: [],
  constraints: ['do not touch tests'],
  expectedPaths: [],
  complete: true,
});

describe('effort hint', () => {
  it('names the level and does not claim a model switch', () => {
    expect(effortInstruction('max')).toContain('Effort preference: max');
    expect(effortInstruction('low')).toContain('does not switch the model');
  });

  it('leaves the intent alone when no effort was sent', () => {
    const base = intent();
    expect(withEffort(base, undefined)).toBe(base);
  });

  it('appends one constraint and does not duplicate it', () => {
    const once = withEffort(intent(), 'high');
    expect(once.constraints).toHaveLength(2);
    expect(once.constraints[1]).toBe(effortInstruction('high'));
    expect(withEffort(once, 'high').constraints).toHaveLength(2);
  });
});

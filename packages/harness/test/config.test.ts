/**
 * Default harness caps — the planned-step ceilings a run inherits unless a
 * caller overrides them.
 * @module
 */

import { describe, expect, it } from 'vitest';

import { defaultHarnessConfig, resolveConfig } from '../src/config.js';

describe('defaultHarnessConfig iteration caps', () => {
  it('allows 1000 model iterations and tool calls per step', () => {
    expect(defaultHarnessConfig.maxIterationsPerStep).toBe(1000);
    expect(defaultHarnessConfig.maxToolCallsPerStep).toBe(1000);
    const resolved = resolveConfig();
    expect(resolved.maxIterationsPerStep).toBe(1000);
    expect(resolved.maxToolCallsPerStep).toBe(1000);
  });

  it('still honors an explicit lower cap', () => {
    const resolved = resolveConfig({ maxIterationsPerStep: 2, maxToolCallsPerStep: 3 });
    expect(resolved.maxIterationsPerStep).toBe(2);
    expect(resolved.maxToolCallsPerStep).toBe(3);
  });
});

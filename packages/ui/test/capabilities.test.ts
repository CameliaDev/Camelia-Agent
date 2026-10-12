/**
 * Live-engine intervene honesty.
 * @module
 */
import { describe, expect, it } from 'vitest';

import { canIntervene, interveneUnavailableReason } from '../src/window/capabilities.js';

describe('capabilities (fixture / no boot)', () => {
  it('allows rollback and degrade when not attached to a live engine', () => {
    expect(canIntervene('rollback_step')).toBe(true);
    expect(canIntervene('select_provider')).toBe(true);
    expect(interveneUnavailableReason('rollback_step')).toBe('');
  });
});

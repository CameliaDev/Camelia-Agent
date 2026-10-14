import { describe, expect, it } from 'vitest';

import { termPhaseFromTask } from '../src/modes/term/term-phase.js';

describe('termPhaseFromTask', () => {
  it('follows plan, execute, and verify', () => {
    expect(termPhaseFromTask({ status: 'planning', phase: 'planning', subAgents: [] })).toBe('plan');
    expect(termPhaseFromTask({ status: 'executing', phase: 'executing', subAgents: [{ status: 'running' }] })).toBe('execute');
    expect(termPhaseFromTask({ status: 'verifying', phase: 'verifying', subAgents: [{ status: 'ok' }] })).toBe('verify');
  });

  it('is done only when a worker succeeded', () => {
    expect(termPhaseFromTask({ status: 'done', phase: 'delivering', subAgents: [{ status: 'ok' }] })).toBe('done');
    expect(termPhaseFromTask({ status: 'done', phase: 'delivering', subAgents: [] })).toBe('failed');
    expect(termPhaseFromTask({ status: 'done', phase: 'idle', subAgents: [{ status: 'error' }] })).toBe('failed');
    expect(termPhaseFromTask({ status: 'failed', phase: 'idle', subAgents: [] })).toBe('failed');
  });
});
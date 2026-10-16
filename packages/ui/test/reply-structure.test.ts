/**
 * Reply-structure parsing and tool-run grouping.
 * @module
 */
import { describe, expect, it } from 'vitest';

import type { ToolCallView } from '@camelia/agent/view';

import { groupToolCalls, parseReplyStructure, toolGroupLabel } from '../src/modes/chat/reply-structure.js';

function call(id: string, name: string, status: ToolCallView['status']): ToolCallView {
  return {
    id,
    stepId: 'stp',
    taskId: 'tsk',
    name,
    risk: 'read-only',
    reversible: true,
    status,
    input: {},
    approval: 'none',
    at: 1,
    ...(status === 'ok' ? { output: 'done' } : {}),
  };
}

describe('parseReplyStructure', () => {
  it('extracts goal, constraints and plan', () => {
    const parsed = parseReplyStructure(
      [
        'Goal: Ship the PDF.',
        '',
        'Constraints:',
        '- FULL',
        '',
        'Short plan:',
        '1. Search',
        '2. Write',
        '',
        'Done.',
      ].join('\n'),
    );
    expect(parsed?.goal).toBe('Ship the PDF.');
    expect(parsed?.constraints).toEqual(['FULL']);
    expect(parsed?.plan).toEqual(['Search', 'Write']);
    expect(parsed?.body).toBe('Done.');
  });

  it('returns undefined without all three markers', () => {
    expect(parseReplyStructure('Goal: only')).toBeUndefined();
  });
});

describe('groupToolCalls', () => {
  it('groups consecutive finished tools', () => {
    const groups = groupToolCalls([
      call('1', 'web_search', 'ok'),
      call('2', 'fs.read', 'ok'),
      call('3', 'shell.exec', 'running'),
    ]);
    const first = groups[0];
    const second = groups[1];
    expect(first).toMatchObject({ kind: 'group' });
    expect(second).toMatchObject({ kind: 'single' });
    if (first && first.kind === 'group') {
      expect(toolGroupLabel(first.calls)).toContain('web_search');
    }
  });
});

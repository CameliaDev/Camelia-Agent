/**
 * Coalesce consecutive assistant turns — one user ask, one bubble.
 * @module
 */

import { describe, expect, it } from 'vitest';

import type { ChatTurnView, ToolCallView } from '@camelia/agent/view';

import { answerBody, coalesceTranscript } from '../src/modes/chat/reply-structure.js';

function turn(partial: Partial<ChatTurnView> & Pick<ChatTurnView, 'id' | 'role' | 'text'>): ChatTurnView {
  return { streaming: false, toolCalls: [], at: 1, ...partial };
}

function tool(id: string, name: string, status: ToolCallView['status'] = 'ok'): ToolCallView {
  return {
    id,
    stepId: 'stp',
    taskId: 'tsk',
    name,
    risk: 'read-only',
    reversible: true,
    status,
    input: {},
    durationMs: 1,
    approval: 'none',
    at: 1,
  };
}

describe('coalesceTranscript', () => {
  it('merges consecutive assistant turns into one item', () => {
    const items = coalesceTranscript([
      turn({ id: 'u1', role: 'user', text: 'search', at: 1 }),
      turn({ id: 'a1', role: 'assistant', text: '', toolCalls: [tool('c1', 'web_search', 'error')], at: 2 }),
      turn({ id: 'a2', role: 'assistant', text: '', toolCalls: [tool('c2', 'web_search', 'ok')], at: 3 }),
      turn({ id: 'a3', role: 'assistant', text: '', streaming: true, at: 4 }),
      turn({ id: 'u2', role: 'user', text: 'thanks', at: 5 }),
      turn({ id: 'a4', role: 'assistant', text: 'sure', at: 6 }),
    ]);
    expect(items).toHaveLength(4);
    expect(items[0]).toMatchObject({ kind: 'user', turn: { id: 'u1' } });
    expect(items[1]?.kind).toBe('assistant');
    if (items[1]?.kind === 'assistant') {
      expect(items[1].turns.map((t) => t.id)).toEqual(['a1', 'a2', 'a3']);
      expect(items[1].turns.flatMap((t) => t.toolCalls).map((c) => c.status)).toEqual(['error', 'ok']);
    }
    expect(items[2]).toMatchObject({ kind: 'user', turn: { id: 'u2' } });
    expect(items[3]?.kind).toBe('assistant');
  });
});

describe('answerBody', () => {
  it('strips Goal/Constraints/Plan and keeps the answer', () => {
    const text = [
      'Goal: find the problem',
      'Constraints:',
      '- use web_search',
      'Short plan:',
      '1. search',
      '2. summarize',
      'Here is the summary.',
    ].join('\n');
    expect(answerBody(text)).toBe('Here is the summary.');
  });
});

/**
 * Work token gate: think first, then a token; no token means no tools;
 * an out-of-bounds call hands the token back and does not authorize another.
 * @module
 */

import { describe, expect, it } from 'vitest';

import { pathWithinBounds, WorkTokenGate, type WorkThought } from '../src/work/WorkTokenGate.js';
import { parseWorkThought } from '../src/work/thought.js';
import { runTokenGatedWorker } from '../src/work/gated-worker.js';
import type { ChatChunk, ChatRequest, LLMPort } from '@camelia/core';

const thought: WorkThought = {
  goals: ['rename the notes'],
  constraints: ['stay inside notes/'],
  plan: ['read notes/a.md', 'write the new title'],
};

describe('WorkTokenGate', () => {
  it('refuses a token when the sub-AI has not stated a goal and a short plan', () => {
    const gate = new WorkTokenGate();
    const missing = gate.issue('writer', undefined, { allowedTools: ['*'], pathPrefixes: [], maxToolCalls: 4 });
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.handedBack).toBe(false);
    expect(missing.reason).toMatch(/short plan/);

    const planOnly = gate.issue('writer', { goals: [], constraints: [], plan: ['write'] }, {
      allowedTools: ['*'],
      pathPrefixes: [],
      maxToolCalls: 4,
    });
    expect(planOnly.ok).toBe(false);

    const call = gate.authorize(undefined, 'fs.read', { path: 'notes/a.md' });
    expect(call.ok).toBe(false);
    if (call.ok) return;
    expect(call.reason).toMatch(/no token/);
  });

  it('issues a token after a thought and hands it back when the path leaves the bounds', () => {
    const gate = new WorkTokenGate();
    const issued = gate.issue('writer', thought, {
      allowedTools: ['fs.read', 'fs.write'],
      pathPrefixes: ['notes'],
      maxToolCalls: 2,
    });
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;

    const read = gate.authorize(issued.token.id, 'fs.read', { path: 'notes/a.md' });
    expect(read.ok).toBe(true);

    const outside = gate.authorize(issued.token.id, 'fs.write', { path: 'secret/key.txt' });
    expect(outside.ok).toBe(false);
    if (outside.ok) return;
    expect(outside.handedBack).toBe(true);
    expect(issued.token.status).toBe('returned');

    const again = gate.authorize(issued.token.id, 'fs.read', { path: 'notes/a.md' });
    expect(again.ok).toBe(false);
  });

  it('refuses a tool that was not on the token, without running it', () => {
    const gate = new WorkTokenGate();
    const issued = gate.issue('writer', thought, { allowedTools: ['fs.read'], pathPrefixes: [], maxToolCalls: 3 });
    if (!issued.ok) throw new Error('expected a token');
    const shell = gate.authorize(issued.token.id, 'shell.exec', { command: 'rm -rf .' });
    expect(shell.ok).toBe(false);
    if (shell.ok) return;
    expect(shell.handedBack).toBe(true);
    expect(shell.reason).toMatch(/shell.exec/);
  });
});

describe('parseWorkThought', () => {
  it('accepts a fenced thought and rejects one with no plan', () => {
    const parsed = parseWorkThought('```json\n{"goals":["ship it"],"constraints":[],"plan":["write the file"]}\n```');
    expect(parsed?.goals).toEqual(['ship it']);
    expect(parsed?.plan).toEqual(['write the file']);
    expect(parseWorkThought('{"goals":["ship it"],"plan":[]}')).toBeUndefined();
    expect(parseWorkThought('just prose')).toBeUndefined();
  });
});

describe('pathWithinBounds', () => {
  it('treats a prefix and a nested file as inside, and a sibling as outside', () => {
    expect(pathWithinBounds('notes/a.md', ['notes'])).toBe(true);
    expect(pathWithinBounds('other/a.md', ['notes'])).toBe(false);
    expect(pathWithinBounds('anywhere.txt', [])).toBe(true);
  });
});

describe('runTokenGatedWorker', () => {
  it('does not invoke a tool when the worker has no token', async () => {
    let invoked = 0;
    const report = await runTokenGatedWorker({
      spec: { goal: 'write the notes', role: 'writer' },
      token: undefined,
      gate: new WorkTokenGate(),
      memory: '',
      model: 'scripted',
      llm: silentPort(),
      tools: [],
      invoke: async () => {
        invoked += 1;
        return 'ran';
      },
      parentTaskId: 'parent',
      now: () => 1,
      signal: new AbortController().signal,
    });
    expect(invoked).toBe(0);
    expect(report.status).toBe('error');
    expect(report.summary).toMatch(/no token/);
  });

  it('hands the token back and skips invoke when the model asks for a forbidden tool', async () => {
    const gate = new WorkTokenGate();
    const issued = gate.issue('writer', thought, { allowedTools: ['fs.read'], pathPrefixes: ['notes'], maxToolCalls: 2 });
    if (!issued.ok) throw new Error('expected a token');
    let invoked = 0;
    const report = await runTokenGatedWorker({
      spec: { goal: 'write the notes', role: 'writer' },
      token: issued.token,
      gate,
      memory: '- the title stays',
      model: 'scripted',
      llm: scriptedPort([
        {
          type: 'tool-call',
          call: { id: 'c1', name: 'shell.exec', arguments: { command: 'rm -rf .' } },
        },
      ]),
      tools: [{ name: 'fs.read', description: 'read', parameters: { type: 'object' } }],
      invoke: async () => {
        invoked += 1;
        return 'ran';
      },
      parentTaskId: 'parent',
      now: () => 2,
      signal: new AbortController().signal,
    });
    expect(invoked).toBe(0);
    expect(report.summary).toMatch(/handed back/);
    expect(issued.token.status).toBe('returned');
  });

  it('invokes a tool that the token allows', async () => {
    const gate = new WorkTokenGate();
    const issued = gate.issue('writer', thought, { allowedTools: ['fs.read'], pathPrefixes: ['notes'], maxToolCalls: 2 });
    if (!issued.ok) throw new Error('expected a token');
    const calls: string[] = [];
    const report = await runTokenGatedWorker({
      spec: { goal: 'write the notes', role: 'writer' },
      token: issued.token,
      gate,
      memory: '',
      model: 'scripted',
      llm: scriptedPort(
        [{ type: 'tool-call', call: { id: 'c1', name: 'fs.read', arguments: { path: 'notes/a.md' } } }],
        [{ type: 'text-delta', text: 'title updated' }],
      ),
      tools: [{ name: 'fs.read', description: 'read', parameters: { type: 'object' } }],
      invoke: async (name) => {
        calls.push(name);
        return '{"ok":true}';
      },
      parentTaskId: 'parent',
      now: () => 3,
      signal: new AbortController().signal,
    });
    expect(calls).toEqual(['fs.read']);
    expect(report.status).toBe('ok');
    expect(report.summary).toBe('title updated');
  });
});

function silentPort(): LLMPort {
  return scriptedPort([]);
}

function scriptedPort(...turns: ChatChunk[][]): LLMPort {
  const queue = [...turns];
  return {
    id: 'scripted',
    capabilities: () => ({
      supportsTools: true,
      supportsJson: true,
      supportsStreaming: true,
      quality: 1,
      textToolCalls: false,
      maxContextWindow: 8000,
    }),
    listModels: async () => [],
    chat: async function* (_request: ChatRequest, signal?: AbortSignal): AsyncIterable<ChatChunk> {
      const turn = queue.shift() ?? [];
      for (const chunk of turn) {
        if (signal?.aborted) return;
        yield chunk;
      }
    },
  };
}

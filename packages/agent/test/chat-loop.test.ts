/**
 * ChatLoop — the direct conversation path (对话 mode).
 *
 * A scripted LLMPort plays the model; everything else is real: the real
 * ToolEngine with built-in tools against a temp workspace, a real in-memory
 * SQLite session store and a real event bus. What is asserted is the event
 * family the UI transcript folds on — a chat turn must never enter the task
 * state machine (no clarify, no plan, no steps, no acceptance).
 * @module
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  EventBus,
  SqliteSessionStore,
  systemClock,
  type ChatChunk,
  type ChatRequest,
  type DomainEvent,
  type LLMPort,
  type ToolCall,
} from '@camelia/core';
import {
  builtinTools,
  defaultHarnessConfig,
  ToolEngine,
  type ApprovalResponder,
  type HarnessPorts,
} from '@camelia/harness';

import { createLogger } from '../src/adapters/logger.js';
import { NodeFs } from '../src/adapters/NodeFs.js';
import { NodeSearch } from '../src/adapters/NodeSearch.js';
import { NodeShell } from '../src/adapters/NodeShell.js';
import { ChatLoop } from '../src/runtime/ChatLoop.js';

const roots: string[] = [];
const originalHome = process.env.CAMELIA_HOME;

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

beforeAll(() => {
  // ChatLoop writes journal backups under CAMELIA_HOME; keep that off the real home.
  process.env.CAMELIA_HOME = tempDir('camelia-chat-home-');
});

afterAll(() => {
  if (originalHome === undefined) delete process.env.CAMELIA_HOME;
  else process.env.CAMELIA_HOME = originalHome;
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// scripted model — pops one chunk list per chat() call
// ---------------------------------------------------------------------------

interface ScriptedTurn {
  chunks: ChatChunk[];
}

function scriptedLLM(turns: ScriptedTurn[]) {
  const requests: ChatRequest[] = [];
  const port = {
    id: 'scripted',
    capabilities: () => ({}),
    listModels: async () => [],
    requests,
    chat: async function* (request: ChatRequest, signal?: AbortSignal): AsyncIterable<ChatChunk> {
      requests.push(request);
      const turn = turns.shift();
      if (!turn) throw new Error('scripted LLM exhausted');
      for (const chunk of turn.chunks) {
        if (signal?.aborted) return;
        yield chunk;
      }
    },
  };
  return port as unknown as LLMPort & { requests: ChatRequest[] };
}

// ---------------------------------------------------------------------------

async function makeLoop(llm: LLMPort, options: { responder?: ApprovalResponder } = {}) {
  const workspace = tempDir('camelia-chat-ws-');
  const store = new SqliteSessionStore(':memory:');
  const session = await store.createSession({
    title: 'chat tests',
    workspace,
    provider: 'scripted',
    model: 'scripted',
  });
  const bus = new EventBus();
  const events: DomainEvent[] = [];
  // Clone on arrival: ChatLoop mutates and re-emits the same record object for
  // every tool transition; the fold copies per event, so tests must too.
  bus.onAny((event) => events.push(structuredClone(event)));
  const logger = createLogger({ level: 'error', write: () => undefined });
  const tools = new ToolEngine(logger);
  tools.registerAll(builtinTools);
  const ports: HarnessPorts = {
    llm,
    fs: new NodeFs(workspace),
    shell: new NodeShell(),
    search: new NodeSearch(workspace),
    clock: systemClock,
    logger,
  };
  const loop = new ChatLoop({
    workspace,
    ports,
    tools,
    bus,
    store,
    logger,
    config: defaultHarnessConfig,
    fallback: llm,
    model: 'scripted',
    responder: options.responder,
  });
  return { loop, events, store, session, workspace };
}

function typesOf(events: DomainEvent[]): string[] {
  return events.map((e) => e.type);
}

function payloads(events: DomainEvent[], type: string): unknown[] {
  return events.filter((e) => e.type === type).map((e) => e.payload as unknown);
}

/** Poll until `predicate` holds — chat() runs concurrently with the assertions. */
async function until(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (predicate()) return;
    if (Date.now() - start > timeoutMs) throw new Error('condition not reached in time');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe('ChatLoop — direct replies (no task machinery)', () => {
  it('streams a plain answer as delta → message on one assistant turn', async () => {
    const { loop, events, store, session } = await makeLoop(
      scriptedLLM([
        { chunks: [{ type: 'text-delta', text: '你好' }, { type: 'text-delta', text: '！' }] },
        { chunks: [{ type: 'text-delta', text: 'second' }] },
      ]),
    );

    await loop.chat(session.id, 'hello', 'readonly-sandbox');
    await loop.chat(session.id, 'again', 'readonly-sandbox');

    // First turn: announce, pick the posture, stream, close.
    expect(typesOf(events)).toEqual([
      'chat.received',
      'chat.policy_changed',
      'chat.delta',
      'chat.delta',
      'chat.message',
      // Second turn: no policy_changed — the posture did not move.
      'chat.received',
      'chat.delta',
      'chat.message',
    ]);
    expect((payloads(events, 'chat.policy_changed')[0] as { policy: string }).policy).toBe('readonly-sandbox');

    // The user turn and the assistant turn are distinct ids; deltas + message
    // share the assistant turn id — exactly what the transcript fold expects.
    const received = payloads(events, 'chat.received')[0] as { turnId: string; text: string };
    const message = payloads(events, 'chat.message')[0] as { turnId: string; role: string; text: string };
    expect(received.text).toBe('hello');
    expect(message.role).toBe('assistant');
    expect(message.text).toBe('你好！');
    expect(message.turnId).not.toBe(received.turnId);
    const turnIds = [
      ...(payloads(events, 'chat.received') as { turnId: string }[]).map((p) => p.turnId),
      ...(payloads(events, 'chat.message') as { turnId: string }[]).map((p) => p.turnId),
    ];
    for (const delta of payloads(events, 'chat.delta') as { turnId: string }[]) {
      expect(turnIds).toContain(delta.turnId);
    }

    // Never any task machinery on the chat path.
    expect(events.some((e) => /^(task|plan|step|clarify|verify)\./.test(e.type))).toBe(false);

    // The first message of a session names it.
    const renamed = await store.getSession(session.id);
    expect(renamed?.title).toBe('hello');
    expect(loop.busy).toBe(false);
  });
});

describe('ChatLoop — tools under the policy gate', () => {
  it('runs a read-only tool and feeds the result back to the model', async () => {
    const llm = scriptedLLM([
      { chunks: [{ type: 'tool-call', call: { id: 'call_list', name: 'fs.list', arguments: { dir: '.' } } }] },
      { chunks: [{ type: 'text-delta', text: 'found it' }] },
    ]);
    const { loop, events, session, workspace } = await makeLoop(llm);
    fs.writeFileSync(path.join(workspace, 'note.txt'), 'hi');

    await loop.chat(session.id, 'what is in the workspace?', 'readonly-sandbox');

    // Same record announced through every transition, ending ok — never a task
    // tool call: the cards land under the current chat turn.
    const calls = payloads(events, 'chat.tool').map((p) => (p as { call: ToolCall }).call);
    expect(calls.map((c) => c.status)).toEqual(['pending', 'approved', 'running', 'ok']);
    expect(new Set(calls.map((c) => c.id)).size).toBe(1);
    expect(JSON.stringify(calls.at(-1)!.output)).toContain('note.txt');
    expect(calls[0]!.taskId).toBe(calls[0]!.stepId);

    // The model saw the tool feedback before answering.
    expect(llm.requests).toHaveLength(2);
    const toolMsg = llm.requests[1]!.messages.find((m) => m.role === 'tool');
    expect(toolMsg?.toolCallId).toBe('call_list');
    expect(toolMsg?.content).toContain('note.txt');

    // The turn closed with a normal message, not a failure.
    expect(events.at(-1)!.type).toBe('chat.message');
    expect(typesOf(events)).not.toContain('chat.failed');
  });

  it('denies a write tool under readonly-sandbox and explains instead of failing', async () => {
    const llm = scriptedLLM([
      {
        chunks: [
          { type: 'tool-call', call: { id: 'call_write', name: 'fs.write', arguments: { path: 'evil.txt', content: 'x' } } },
        ],
      },
      { chunks: [{ type: 'text-delta', text: 'I cannot write files right now.' }] },
    ]);
    const { loop, events, session, workspace } = await makeLoop(llm);

    await loop.chat(session.id, 'write a file', 'readonly-sandbox');

    const calls = payloads(events, 'chat.tool').map((p) => (p as { call: ToolCall }).call);
    expect(calls.map((c) => c.status)).toEqual(['pending', 'denied']);
    expect(fs.existsSync(path.join(workspace, 'evil.txt'))).toBe(false);

    // The denial is fed back as guidance, so the model explains rather than retries.
    const toolMsg = llm.requests[1]!.messages.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toContain('DENIED');
    expect(events.at(-1)!.type).toBe('chat.message');
    expect(typesOf(events)).not.toContain('chat.failed');
  });
});

describe('ChatLoop — ask_user round-trip', () => {
  it('emits the picker, accepts the answer and reports the choice to the model', async () => {
    const llm = scriptedLLM([
      {
        chunks: [
          {
            type: 'tool-call',
            call: { id: 'call_ask', name: 'ask_user', arguments: { question: 'Which one?', options: ['A', 'B', 'C'] } },
          },
        ],
      },
      { chunks: [{ type: 'text-delta', text: 'you chose B' }] },
    ]);
    const { loop, events, session } = await makeLoop(llm);

    const running = loop.chat(session.id, 'decide for me', 'ask');
    await until(() => events.some((e) => e.type === 'chat.ask_user'));

    const ask = payloads(events, 'chat.ask_user')[0] as { askId: string; question: string; options: string[] };
    expect(ask.question).toBe('Which one?');
    expect(ask.options).toEqual(['A', 'B', 'C']);
    // Unknown ask ids are rejected; the real one settles the picker.
    expect(loop.answer('nope', 0)).toBe(false);
    expect(loop.answer(ask.askId, 1)).toBe(true);

    await running;

    expect(payloads(events, 'chat.answered')).toEqual([{ askId: ask.askId, optionIdx: 1 }]);
    // ask_user never reaches the ToolEngine — no tool card for it.
    expect(typesOf(events)).not.toContain('chat.tool');
    // The choice itself is the tool feedback.
    const toolMsg = llm.requests[1]!.messages.find((m) => m.role === 'tool');
    expect(toolMsg?.toolCallId).toBe('call_ask');
    expect(toolMsg?.content).toBe('B');
    expect(events.at(-1)!.type).toBe('chat.message');
  });
});

describe('ChatLoop — cancellation', () => {
  it('keeps the partial text and never emits chat.failed', async () => {
    const llm = {
      id: 'blocking',
      capabilities: () => ({}),
      listModels: async () => [],
      chat: async function* (_request: ChatRequest, signal?: AbortSignal): AsyncIterable<ChatChunk> {
        yield { type: 'text-delta', text: 'partial ' };
        // Block until the abort lands — the user cancelled mid-stream.
        await new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve(), { once: true }));
      },
    } as unknown as LLMPort;
    const { loop, events, session } = await makeLoop(llm);

    const running = loop.chat(session.id, 'hello', 'full');
    await until(() => events.some((e) => e.type === 'chat.delta'));

    // A second turn cannot start while one is in flight.
    await expect(loop.chat(session.id, 'second', 'full')).rejects.toThrow(/in progress/i);

    loop.cancel();
    await running;

    expect(loop.busy).toBe(false);
    // Cancel is not a failure: partial text lands, no chat.failed.
    const message = payloads(events, 'chat.message')[0] as { turnId: string; text: string };
    expect(message.text).toBe('partial ');
    expect(typesOf(events)).not.toContain('chat.failed');
  });
});

describe('ChatLoop — stream errors', () => {
  it('retries a transient error before any output, then succeeds', async () => {
    let attempts = 0;
    const llm = {
      id: 'flaky',
      capabilities: () => ({}),
      listModels: async () => [],
      chat: async function* (): AsyncIterable<ChatChunk> {
        attempts += 1;
        if (attempts < 3) {
          yield { type: 'error', message: 'connection reset', retryable: true };
          return;
        }
        yield { type: 'text-delta', text: 'finally' };
      },
    } as unknown as LLMPort;
    const { loop, events, session } = await makeLoop(llm);

    await loop.chat(session.id, 'hello', 'readonly-sandbox');

    expect(attempts).toBe(3);
    // Retries before any output are invisible to the transcript: one turn, one message.
    const deltas = payloads(events, 'chat.delta') as { delta: string }[];
    expect(deltas.map((d) => d.delta)).toEqual(['finally']);
    expect(typesOf(events)).not.toContain('chat.failed');
  });

  it('fails the turn visibly when the stream keeps erroring', async () => {
    const llm = {
      id: 'dead',
      capabilities: () => ({}),
      listModels: async () => [],
      chat: async function* (): AsyncIterable<ChatChunk> {
        yield { type: 'error', message: 'provider down', retryable: true };
      },
    } as unknown as LLMPort;
    const { loop, events, session } = await makeLoop(llm);

    await loop.chat(session.id, 'hello', 'readonly-sandbox');

    // The empty delta opens a turn so the failure has somewhere to land.
    expect((payloads(events, 'chat.delta') as { delta: string }[]).map((d) => d.delta)).toEqual(['']);
    const failed = payloads(events, 'chat.failed')[0] as { turnId: string; error: string };
    expect(failed.error).toContain('provider down');
    // Every retry shared one assistant turn id.
    const deltas = payloads(events, 'chat.delta') as { turnId: string }[];
    expect(new Set(deltas.map((d) => d.turnId))).toEqual(new Set([failed.turnId]));
  });
});

describe('ChatLoop — iteration budget', () => {
  it('stops after 1000 tool iterations and reports that cap', async () => {
    let calls = 0;
    const llm = {
      id: 'looping',
      capabilities: () => ({}),
      listModels: async () => [],
      chat: async function* (): AsyncIterable<ChatChunk> {
        calls += 1;
        yield { type: 'tool-call', call: { id: `c${calls}`, name: 'not.a.tool', arguments: {} } };
      },
    } as unknown as LLMPort;
    const { loop, events, session } = await makeLoop(llm);

    await loop.chat(session.id, 'keep going', 'readonly-sandbox');

    expect(calls).toBe(1000);
    const failed = payloads(events, 'chat.failed') as { error: string }[];
    expect(failed).toEqual([{ error: 'Stopped after 1000 tool iterations.', turnId: expect.any(String) }]);
    expect(events.at(-1)!.type).toBe('chat.failed');
    expect(typesOf(events)).not.toContain('chat.message');
  });
});

describe('ChatLoop — history window', () => {
  it('carries earlier turns into later requests and trims the oldest', async () => {
    const llm = scriptedLLM([
      { chunks: [{ type: 'text-delta', text: 'first reply' }] },
      { chunks: [{ type: 'text-delta', text: 'second reply' }] },
    ]);
    const { loop, session } = await makeLoop(llm);

    await loop.chat(session.id, 'question one', 'readonly-sandbox');
    await loop.chat(session.id, 'question two', 'readonly-sandbox');

    const second = llm.requests[1]!;
    const roles = second.messages.map((m) => m.role);
    // system, user, assistant (turn 1), user (turn 2) — the conversation, not a fresh prompt.
    expect(roles).toEqual(['system', 'user', 'assistant', 'user']);
    expect(second.messages[1]?.content).toBe('question one');
    expect(second.messages[3]?.content).toBe('question two');
    // The window is capped: oldest messages drop, and a tool result never leads.
    expect(second.messages.length).toBeLessThanOrEqual(41);
  });
});

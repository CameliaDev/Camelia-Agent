/**
 * Providers (whitepaper §5.3, §9.3).
 *
 * `MockProvider` + `ScriptedAgentProvider` are how the architecture is verified
 * without spending model quota; `OpenAICompatibleProvider` is the one code path
 * that covers all three free providers.
 * @module
 */

import type { ChatChunk, ChatRequest } from '@camelia/core';
import { collectChat } from '@camelia/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MockProvider, type Script } from '../src/providers/MockProvider.js';
import { OpenAICompatibleProvider } from '../src/providers/OpenAICompatibleProvider.js';
import { mockDemoSpec, scriptedTaskScript } from '../src/providers/ScriptedAgentProvider.js';

const REQUEST: ChatRequest = { model: 'm', messages: [{ role: 'user', content: 'hi' }] };

function request(system: string, user = 'do the thing'): ChatRequest {
  return {
    model: 'm',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// MockProvider
// ---------------------------------------------------------------------------

describe('MockProvider — scripting', () => {
  it('streams a scripted turn as two deltas', async () => {
    const provider = new MockProvider({ script: [{ text: 'abcdef' }] });
    const response = await collectChat(provider.chat(REQUEST));
    expect(response.chunks.filter((c) => c.type === 'text-delta')).toHaveLength(2);
    expect(response.text).toBe('abcdef');
    expect(response.finishReason).toBe('stop');
  });

  it('consumes an array script in order, then falls back', async () => {
    const provider = new MockProvider({
      script: [{ text: 'first' }, { text: 'second' }],
      fallback: { text: 'default' },
    });
    expect((await collectChat(provider.chat(REQUEST))).text).toBe('first');
    expect((await collectChat(provider.chat(REQUEST))).text).toBe('second');
    expect((await collectChat(provider.chat(REQUEST))).text).toBe('default');
    expect(provider.calls).toBe(3);
  });

  it('supports a function script keyed on the call index', async () => {
    const script: Script = (_request, callIndex) => ({ text: `call-${callIndex}` });
    const provider = new MockProvider({ script });
    expect((await collectChat(provider.chat(REQUEST))).text).toBe('call-0');
    expect((await collectChat(provider.chat(REQUEST))).text).toBe('call-1');
  });

  it('yields an error turn verbatim', async () => {
    const provider = new MockProvider({ script: [{ error: { message: 'boom', retryable: false } }] });
    const chunks: ChatChunk[] = [];
    for await (const chunk of provider.chat(REQUEST)) chunks.push(chunk);
    expect(chunks).toEqual([{ type: 'error', message: 'boom', retryable: false }]);
  });

  it('emits tool calls with generated ids', async () => {
    const provider = new MockProvider({ script: [{ toolCalls: [{ name: 'fs.write', arguments: { path: 'a' } }] }] });
    const response = await collectChat(provider.chat(REQUEST));
    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls[0]!.name).toBe('fs.write');
    expect(response.toolCalls[0]!.id).toMatch(/^mock-call-/);
    expect(response.finishReason).toBe('tool_calls');
  });

  it('advertises the models and capabilities it was configured with', async () => {
    const provider = new MockProvider({ id: 'p', models: ['a', 'b'], capabilities: { maxContextWindow: 4_000 } });
    expect(provider.id).toBe('p');
    expect(provider.capabilities().maxContextWindow).toBe(4_000);
    expect((await provider.listModels()).map((m) => m.id)).toEqual(['a', 'b']);
  });
});

describe('MockProvider — cancellation', () => {
  it('reports an already-aborted signal as an error chunk without waiting', async () => {
    const provider = new MockProvider({ script: [{ text: 'late', delayMs: 60_000 }] });
    const controller = new AbortController();
    controller.abort();
    const chunks: ChatChunk[] = [];
    for await (const chunk of provider.chat(REQUEST, controller.signal)) chunks.push(chunk);
    expect(chunks).toEqual([{ type: 'error', message: 'aborted', retryable: false }]);
  });

  it('reports an abort that happens during the delay as an error chunk', async () => {
    const provider = new MockProvider({ script: [{ text: 'late', delayMs: 60_000 }] });
    const controller = new AbortController();
    const chunks: ChatChunk[] = [];
    const consume = (async () => {
      for await (const chunk of provider.chat(REQUEST, controller.signal)) chunks.push(chunk);
    })();
    controller.abort();
    await consume;
    expect(chunks).toEqual([{ type: 'error', message: 'aborted', retryable: false }]);
  });
});

// ---------------------------------------------------------------------------
// ScriptedAgentProvider
// ---------------------------------------------------------------------------

describe('ScriptedAgentProvider — stage detection', () => {
  it('clarifies by restating the goal and listing the target paths', () => {
    const script = scriptedTaskScript({ create: { 'a.ts': 'x' }, edit: { 'b.ts': { oldText: 'x', newText: 'y' } } });
    const turn = script(request('You are the CLARIFIER.', 'add a file'), 0);
    const parsed = JSON.parse(turn.text!) as { goal: string; expectedPaths: string[]; complete: boolean };
    expect(parsed.goal).toBe('add a file');
    expect(parsed.expectedPaths).toEqual(['a.ts', 'b.ts']);
    expect(parsed.complete).toBe(true);
  });

  it('plans one step per target plus one per command, each with acceptance', () => {
    const script = scriptedTaskScript({ create: { 'a.ts': 'x' }, commands: ['node --version'] });
    const turn = script(request('You are the PLANNER.'), 0);
    const parsed = JSON.parse(turn.text!) as { steps: { title: string; deps: number[]; acceptance: { kind: string }[] }[] };
    expect(parsed.steps).toHaveLength(2);
    expect(parsed.steps[0]!.acceptance[0]!.kind).toBe('file-exists');
    expect(parsed.steps[1]!.acceptance[0]!.kind).toBe('command-exit-zero');
    expect(parsed.steps[1]!.deps).toEqual([0]);
  });

  it('plans a single manual step when there is nothing to mutate', () => {
    const turn = scriptedTaskScript({})(request('You are the PLANNER.'), 0);
    const parsed = JSON.parse(turn.text!) as { steps: { acceptance: { kind: string }[] }[] };
    expect(parsed.steps).toHaveLength(1);
    expect(parsed.steps[0]!.acceptance[0]!.kind).toBe('manual');
  });

  it('executes a create as fs.write with the exact content', () => {
    const script = scriptedTaskScript({ create: { 'a.ts': 'export const a = 1;\n' } });
    const turn = script(request('You are the EXECUTOR. Acceptance: {"path":"a.ts"}'), 0);
    expect(turn.toolCalls).toEqual([
      { name: 'fs.write', arguments: { path: 'a.ts', content: 'export const a = 1;\n' } },
    ]);
  });

  it('executes an edit as fs.edit', () => {
    const script = scriptedTaskScript({ edit: { 'a.ts': { oldText: 'old', newText: 'new' } } });
    const turn = script(request('You are the EXECUTOR. Acceptance: {"path":"a.ts"}'), 0);
    expect(turn.toolCalls?.[0]?.name).toBe('fs.edit');
    expect(turn.toolCalls?.[0]?.arguments).toMatchObject({ path: 'a.ts', oldText: 'old', newText: 'new' });
  });

  it('executes a command acceptance as shell.exec', () => {
    const script = scriptedTaskScript({ commands: ['node --version'] });
    const turn = script(request('You are the EXECUTOR. Acceptance: {"command":"node --version"}'), 0);
    expect(turn.toolCalls).toEqual([{ name: 'shell.exec', arguments: { command: 'node --version' } }]);
  });

  it('reports completion (no tool call) on the second pass for the same target', () => {
    const script = scriptedTaskScript({ create: { 'a.ts': 'x' } });
    const first = script(request('You are the EXECUTOR. Acceptance: {"path":"a.ts"}'), 0);
    const second = script(request('You are the EXECUTOR. Acceptance: {"path":"a.ts"}'), 1);
    expect(first.toolCalls).toHaveLength(1);
    expect(second.toolCalls).toBeUndefined();
    expect(second.text).toContain('Wrote a.ts');
  });

  it('recognises the fixup prompt and appends the note', () => {
    const script = scriptedTaskScript({ create: { 'a.ts': 'x' }, note: 'NOTED' });
    const turn = script(request('You are the EXECUTOR. FAILED verification.'), 0);
    expect(turn.toolCalls).toBeUndefined();
    expect(turn.text).toContain('NOTED');
  });

  it('falls back gracefully on an unrecognised prompt', () => {
    const turn = scriptedTaskScript({})(request('Some other system prompt.'), 0);
    expect(turn.text).toContain('unrecognised');
  });

  it('mockDemoSpec writes a self-describing note file and lists the workspace', () => {
    const spec = mockDemoSpec('create a test file');
    expect(Object.keys(spec.create!)).toEqual(['camelia-mock-output.md']);
    expect(spec.create!['camelia-mock-output.md']).toContain('Task: create a test file');
    expect(spec.commands).toEqual(['node --version']);
  });
});

// ---------------------------------------------------------------------------
// OpenAICompatibleProvider
// ---------------------------------------------------------------------------

describe('OpenAICompatibleProvider — request body', () => {
  const provider = new OpenAICompatibleProvider({
    id: 'p',
    baseUrl: 'https://x/v1',
    models: ['m1', 'm2'],
    defaultModel: 'm2',
  });

  it('defaults to the configured model and always streams with usage', () => {
    const body = provider.buildBody({ model: '', messages: [{ role: 'user', content: 'hi' }] });
    expect(body.model).toBe('m2');
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
  });

  it('keeps a pinned model', () => {
    expect(provider.buildBody({ model: 'm1', messages: [] }).model).toBe('m1');
  });

  it('includes tool schemas when the provider supports tools', () => {
    const body = provider.buildBody({
      model: 'm1',
      messages: [],
      tools: [{ name: 'fs.read', description: 'read', parameters: { type: 'object' } }],
    });
    expect(body.tools).toEqual([
      { type: 'function', function: { name: 'fs.read', description: 'read', parameters: { type: 'object' } } },
    ]);
  });

  it('omits tool schemas when the provider cannot use tools', () => {
    const noTools = new OpenAICompatibleProvider({ id: 'p', baseUrl: 'x', models: ['m'], capabilities: { supportsTools: false } });
    const body = noTools.buildBody({ model: 'm', messages: [], tools: [{ name: 't', description: 'd', parameters: {} }] });
    expect(body.tools).toBeUndefined();
  });

  it('serializes assistant tool calls and tool results', () => {
    const body = provider.buildBody({
      model: 'm1',
      messages: [
        { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'fs.write', arguments: { path: 'a' } }] },
        { role: 'tool', content: 'ok', name: 'fs.write', toolCallId: 'c1' },
      ],
    });
    const messages = body.messages as Record<string, unknown>[];
    expect((messages[0]!.tool_calls as Record<string, unknown>[])[0]).toMatchObject({
      id: 'c1',
      type: 'function',
      function: { name: 'fs.write', arguments: '{"path":"a"}' },
    });
    expect(messages[1]).toMatchObject({ role: 'tool', tool_call_id: 'c1', name: 'fs.write' });
  });

  it('requests a JSON object response only when supported', () => {
    expect(provider.buildBody({ model: 'm1', messages: [], responseFormat: 'json' }).response_format).toEqual({ type: 'json_object' });
    const noJson = new OpenAICompatibleProvider({ id: 'p', baseUrl: 'x', models: ['m'], capabilities: { supportsJson: false } });
    expect(noJson.buildBody({ model: 'm', messages: [], responseFormat: 'json' }).response_format).toBeUndefined();
  });

  it('passes temperature and max tokens through', () => {
    const body = provider.buildBody({ model: 'm1', messages: [], temperature: 0.2, maxTokens: 512 });
    expect(body.temperature).toBe(0.2);
    expect(body.max_tokens).toBe(512);
  });

  it('advertises models with the provider id', async () => {
    expect(await provider.listModels()).toEqual([
      expect.objectContaining({ id: 'm1', providerId: 'p' }),
      expect.objectContaining({ id: 'm2', providerId: 'p' }),
    ]);
  });
});

describe('OpenAICompatibleProvider — streaming', () => {
  function sse(lines: string[], status = 200): Response {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const line of lines) controller.enqueue(encoder.encode(line));
        controller.close();
      },
    });
    return new Response(body, { status });
  }

  it('parses text, accumulates tool-call arguments, reports usage and finish reason', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sse([
          'data: {"choices":[{"delta":{"content":"Hel"}}]}\n',
          'data: {"choices":[{"delta":{"content":"lo"}}]}\n',
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"fs.write","arguments":"{\\"path\\":"}}]}}]}\n',
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"a.ts\\"}"}}]}}]}\n',
          'data: {"usage":{"prompt_tokens":10,"completion_tokens":5}}\n',
          'data: {"choices":[{"finish_reason":"tool_calls"}]}\n',
          'data: [DONE]\n',
        ]),
      ),
    );

    const provider = new OpenAICompatibleProvider({ id: 'p', baseUrl: 'https://x/v1', models: ['m'] });
    const response = await collectChat(provider.chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }));
    expect(response.text).toBe('Hello');
    expect(response.toolCalls).toEqual([{ id: 'c1', name: 'fs.write', arguments: '{"path":"a.ts"}' }]);
    expect(response.promptTokens).toBe(10);
    expect(response.completionTokens).toBe(5);
    expect(response.finishReason).toBe('tool_calls');
  });

  it('reports zero usage when a gateway omits it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sse(['data: {"choices":[{"delta":{"content":"x"}}]}\n', 'data: [DONE]\n'])));
    const provider = new OpenAICompatibleProvider({ id: 'p', baseUrl: 'https://x/v1', models: ['m'] });
    const response = await collectChat(provider.chat({ model: 'm', messages: [] }));
    expect(response.promptTokens).toBe(0);
    expect(response.completionTokens).toBe(0);
    expect(response.finishReason).toBe('stop');
  });

  it('classifies 429 and 5xx as retryable, 4xx as fatal', async () => {
    const provider = new OpenAICompatibleProvider({ id: 'p', baseUrl: 'https://x/v1', models: ['m'] });

    vi.stubGlobal('fetch', vi.fn(async () => new Response('rate limited', { status: 429 })));
    let chunks: ChatChunk[] = [];
    for await (const chunk of provider.chat({ model: 'm', messages: [] })) chunks.push(chunk);
    expect(chunks[0]).toMatchObject({ type: 'error', retryable: true });

    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad request', { status: 400 })));
    chunks = [];
    for await (const chunk of provider.chat({ model: 'm', messages: [] })) chunks.push(chunk);
    expect(chunks[0]).toMatchObject({ type: 'error', retryable: false });
    expect((chunks[0] as { message: string }).message).toContain('HTTP 400');
  });

  it('surfaces a network failure as a retryable error chunk', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }));
    const provider = new OpenAICompatibleProvider({ id: 'p', baseUrl: 'https://x/v1', models: ['m'] });
    const chunks: ChatChunk[] = [];
    for await (const chunk of provider.chat({ model: 'm', messages: [] })) chunks.push(chunk);
    expect(chunks[0]).toMatchObject({ type: 'error', retryable: true });
  });
});
/**
 * The three-path fallback chain (whitepaper §5.3).
 *
 * The contract under test is subtle and load-bearing: a provider failure is *not*
 * a retry — it advances a cursor that changes the provider for every subsequent
 * call, so downstream decisions are made against the new provider's capabilities.
 * @module
 */

import { collectChat, type ChatChunk, type ChatRequest } from '@camelia/core';
import { describe, expect, it, vi } from 'vitest';

import { FallbackLLMPort, type FallbackHooks } from '../src/FallbackLLMPort.js';
import type { ProviderHandle } from '../src/ProviderRegistry.js';
import { MockProvider, type Script } from '../src/providers/MockProvider.js';

function handle(id: string, script: Script, model = `${id}-default`): ProviderHandle {
  const models = [model];
  return {
    id,
    label: id,
    model,
    models,
    port: new MockProvider({ id, models, script }),
  };
}

const REQUEST: ChatRequest = { model: 'whatever', messages: [{ role: 'user', content: 'hi' }] };

async function drain(port: FallbackLLMPort, request: ChatRequest = REQUEST): Promise<ChatChunk[]> {
  const chunks: ChatChunk[] = [];
  for await (const chunk of port.chat(request)) chunks.push(chunk);
  return chunks;
}

describe('FallbackLLMPort — construction', () => {
  it('refuses to exist with no providers', () => {
    expect(() => new FallbackLLMPort([])).toThrow(/at least one provider/);
  });

  it('starts on the first provider at depth zero', () => {
    const port = new FallbackLLMPort([handle('a', [{ text: 'ok' }]), handle('b', [{ text: 'ok' }])]);
    expect(port.active.id).toBe('a');
    expect(port.depth).toBe(0);
    expect(port.id).toContain('a -> b');
    expect(port.chain).toEqual([
      { id: 'a', active: true },
      { id: 'b', active: false },
    ]);
  });

  it('reports the initial selection through onSelect', () => {
    const onSelect = vi.fn();
    new FallbackLLMPort([handle('a', [{ text: 'ok' }])], { onSelect });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]![1]).toBe('initial selection');
  });
});

describe('FallbackLLMPort — healthy path', () => {
  it('passes text through and never advances', async () => {
    const port = new FallbackLLMPort([handle('a', [{ text: 'hello' }]), handle('b', [{ text: 'nope' }])]);
    const chunks = await drain(port);
    expect(chunks.filter((c) => c.type === 'text-delta').map((c) => (c as { text: string }).text).join('')).toBe('hello');
    expect(port.active.id).toBe('a');
    expect(port.depth).toBe(0);
  });

  it('delegates capabilities and listModels to the active provider', async () => {
    const port = new FallbackLLMPort([handle('a', [{ text: 'ok' }])]);
    expect(port.capabilities().supportsTools).toBe(true);
    expect(await port.listModels()).toHaveLength(1);
  });
});

describe('FallbackLLMPort — advancing the chain', () => {
  it('advances to the next provider on a retryable error', async () => {
    const hooks: FallbackHooks = { onFallback: vi.fn(), onExhausted: vi.fn() };
    const port = new FallbackLLMPort(
      [
        handle('a', [{ error: { message: 'rate limited', retryable: true } }]),
        handle('b', [{ text: 'rescued' }]),
      ],
      hooks,
    );

    const chunks = await drain(port);
    expect(chunks.filter((c) => c.type === 'text-delta').map((c) => (c as { text: string }).text).join('')).toBe('rescued');
    expect(port.active.id).toBe('b');
    expect(port.depth).toBe(1);
    expect(hooks.onFallback).toHaveBeenCalledTimes(1);
    // (from, to, reason, depth)
    expect(hooks.onFallback).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a' }),
      expect.objectContaining({ id: 'b' }),
      'rate limited',
      1,
    );
    expect(hooks.onExhausted).not.toHaveBeenCalled();
  });

  it('stays advanced for subsequent calls — fallback is not a retry', async () => {
    const port = new FallbackLLMPort([
      handle('a', [{ error: { message: 'down', retryable: true } }, { text: 'a-second' }]),
      handle('b', [{ text: 'b-first' }, { text: 'b-second' }]),
    ]);

    await drain(port);
    expect(port.depth).toBe(1);

    const second = await drain(port);
    const text = second.filter((c) => c.type === 'text-delta').map((c) => (c as { text: string }).text).join('');
    expect(text).toBe('b-second');
    expect(port.active.id).toBe('b');
  });

  it('does not advance on a non-retryable error and surfaces it', async () => {
    const hooks: FallbackHooks = { onFallback: vi.fn() };
    const port = new FallbackLLMPort(
      [
        handle('a', [{ error: { message: 'bad request', retryable: false } }]),
        handle('b', [{ text: 'should not run' }]),
      ],
      hooks,
    );

    const chunks = await drain(port);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ type: 'error', message: 'bad request', retryable: false });
    expect(port.active.id).toBe('a');
    expect(hooks.onFallback).not.toHaveBeenCalled();
  });

  it('never retries another provider once output has been observed', async () => {
    const hooks: FallbackHooks = { onFallback: vi.fn() };
    const port = new FallbackLLMPort(
      [
        // Emits a delta, then fails: partial output cannot be safely replayed.
        {
          id: 'a',
          label: 'a',
          model: 'a-default',
          models: ['a-default'],
          port: {
            id: 'a',
            capabilities: () => ({ supportsTools: true, supportsJson: true, supportsStreaming: true, maxContextWindow: 1000, quality: 0.5 }),
            listModels: async () => [],
            async *chat() {
              yield { type: 'text-delta', text: 'half' } as ChatChunk;
              yield { type: 'error', message: 'died mid-stream', retryable: true } as ChatChunk;
            },
          },
        },
        handle('b', [{ text: 'should not run' }]),
      ],
      hooks,
    );

    const chunks = await drain(port);
    expect(chunks.map((c) => c.type)).toEqual(['text-delta', 'error']);
    expect(hooks.onFallback).not.toHaveBeenCalled();
    expect(port.active.id).toBe('a');
  });

  it('reports exhaustion when every provider fails', async () => {
    const hooks: FallbackHooks = { onExhausted: vi.fn() };
    const port = new FallbackLLMPort(
      [
        handle('a', [{ error: { message: 'a down', retryable: true } }]),
        handle('b', [{ error: { message: 'b down', retryable: true } }]),
      ],
      hooks,
    );

    const chunks = await drain(port);
    expect(chunks.at(-1)).toMatchObject({ type: 'error', retryable: false });
    expect(hooks.onExhausted).toHaveBeenCalledWith('b down');
    expect(port.depth).toBe(1);
  });

  it('treats a thrown provider as a retryable failure', async () => {
    const port = new FallbackLLMPort([
      {
        id: 'a',
        label: 'a',
        model: 'a-default',
        models: ['a-default'],
        port: {
          id: 'a',
          capabilities: () => ({ supportsTools: true, supportsJson: true, supportsStreaming: true, maxContextWindow: 1000, quality: 0.5 }),
          listModels: async () => [],
          // eslint-disable-next-line require-yield
          async *chat(): AsyncIterable<ChatChunk> {
            throw new Error('socket hang up');
          },
        },
      },
      handle('b', [{ text: 'rescued' }]),
    ]);

    const chunks = await drain(port);
    expect(chunks.some((c) => c.type === 'text-delta')).toBe(true);
    expect(port.active.id).toBe('b');
  });
});

describe('FallbackLLMPort — model re-resolution', () => {
  it('re-resolves a pinned model against the provider that will actually serve it', async () => {
    const seen: string[] = [];
    const port = new FallbackLLMPort([
      handle('a', [{ error: { message: 'down', retryable: true } }]),
      {
        id: 'b',
        label: 'b',
        model: 'b-default',
        models: ['b-default'],
        port: {
          id: 'b',
          capabilities: () => ({ supportsTools: true, supportsJson: true, supportsStreaming: true, maxContextWindow: 1000, quality: 0.5 }),
          listModels: async () => [],
          async *chat(request: ChatRequest) {
            seen.push(request.model);
            yield { type: 'text-delta', text: 'ok' } as ChatChunk;
            yield { type: 'done', finishReason: 'stop' } as ChatChunk;
          },
        },
      },
    ]);

    await drain(port, { model: 'a-only-model', messages: [{ role: 'user', content: 'hi' }] });
    // 'a-only-model' is unknown to provider b, so b's own default is used instead.
    expect(seen).toEqual(['b-default']);
  });

  it('keeps a pinned model when the provider advertises it', async () => {
    const seen: string[] = [];
    const port = new FallbackLLMPort([
      {
        id: 'a',
        label: 'a',
        model: 'a-default',
        models: ['a-default', 'pinned'],
        port: {
          id: 'a',
          capabilities: () => ({ supportsTools: true, supportsJson: true, supportsStreaming: true, maxContextWindow: 1000, quality: 0.5 }),
          listModels: async () => [],
          async *chat(request: ChatRequest) {
            seen.push(request.model);
            yield { type: 'done', finishReason: 'stop' } as ChatChunk;
          },
        },
      },
    ]);

    await drain(port, { model: 'pinned', messages: [{ role: 'user', content: 'hi' }] });
    expect(seen).toEqual(['pinned']);
  });
});

describe('FallbackLLMPort — collectChat integration', () => {
  it('materialises a rescued response into a single LLMResponse', async () => {
    const port = new FallbackLLMPort([
      handle('a', [{ error: { message: 'down', retryable: true } }]),
      handle('b', [{ text: 'hello world', finishReason: 'stop' }]),
    ]);
    const response = await collectChat(port.chat(REQUEST));
    expect(response.text).toBe('hello world');
    expect(response.finishReason).toBe('stop');
    expect(response.promptTokens).toBeGreaterThan(0);
  });
});
/**
 * Provider registry (whitepaper §5.3).
 *
 * The registry is the single place that turns config into live ports; the fallback
 * chain is just an ordered list of the handles it produces.
 * @module
 */

import { describe, expect, it } from 'vitest';

import type { CameliaConfig } from '../src/config/load.js';
import { ProviderRegistry, type ProviderHandle } from '../src/ProviderRegistry.js';
import { MockProvider } from '../src/providers/MockProvider.js';
import { OpenAICompatibleProvider } from '../src/providers/OpenAICompatibleProvider.js';

function mockHandle(id: string): ProviderHandle {
  return { id, label: id, model: `${id}-model`, models: [`${id}-model`], port: new MockProvider({ id }) };
}

describe('ProviderRegistry — construction', () => {
  it('preserves handle order and indexes by id', () => {
    const registry = new ProviderRegistry([mockHandle('a'), mockHandle('b')]);
    expect(registry.handles().map((h) => h.id)).toEqual(['a', 'b']);
    expect(registry.size).toBe(2);
    expect(registry.get('b')?.label).toBe('b');
    expect(registry.get('missing')).toBeUndefined();
  });

  it('returns a defensive copy of the handle list', () => {
    const registry = new ProviderRegistry([mockHandle('a')]);
    registry.handles().push(mockHandle('injected'));
    expect(registry.size).toBe(1);
  });
});

describe('ProviderRegistry.fromConfig', () => {
  it('builds a MockProvider for a mock profile', () => {
    const config: CameliaConfig = {
      providers: [{ id: 'mock', label: 'Scripted', kind: 'mock', baseUrl: '', models: ['scripted'], defaultModel: 'scripted' }],
    };
    const handle = ProviderRegistry.fromConfig(config).get('mock');
    expect(handle?.port).toBeInstanceOf(MockProvider);
    expect(handle?.model).toBe('scripted');
  });

  it('builds an OpenAICompatibleProvider for a keyed profile', () => {
    const config: CameliaConfig = {
      providers: [
        {
          id: 'openrouter',
          label: 'OpenRouter',
          kind: 'openai-compatible',
          baseUrl: 'https://openrouter.ai/api/v1',
          apiKey: 'sk-test-1234567890',
          models: ['m1', 'm2'],
          defaultModel: 'm2',
        },
      ],
    };
    const handle = ProviderRegistry.fromConfig(config).get('openrouter');
    expect(handle?.port).toBeInstanceOf(OpenAICompatibleProvider);
    expect(handle?.models).toEqual(['m1', 'm2']);
    expect(handle?.model).toBe('m2');
  });

  it('drops unusable providers so the fallback chain never contains a dead path', () => {
    const config: CameliaConfig = {
      providers: [
        { id: 'ollama', label: 'Ollama', kind: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', models: ['qwen'] },
        { id: 'openrouter', label: 'OR', kind: 'openai-compatible', baseUrl: 'http://x/v1', models: ['m'] },
      ],
    };
    expect(ProviderRegistry.fromConfig(config).handles().map((h) => h.id)).toEqual(['ollama']);
  });

  it('appends extra handles and de-duplicates by id', () => {
    const config: CameliaConfig = {
      providers: [{ id: 'mock', label: 'Mock', kind: 'mock', baseUrl: '', models: ['scripted'] }],
    };
    const registry = ProviderRegistry.fromConfig(config, [mockHandle('mock'), mockHandle('extra')]);
    expect(registry.handles().map((h) => h.id)).toEqual(['mock', 'extra']);
  });

  it('honours the preferred provider ordering from config', () => {
    const config: CameliaConfig = {
      providers: [
        { id: 'a', label: 'A', kind: 'mock', baseUrl: '', models: ['m'] },
        { id: 'b', label: 'B', kind: 'mock', baseUrl: '', models: ['m'] },
      ],
      preferredProvider: 'b',
    };
    expect(ProviderRegistry.fromConfig(config).handles().map((h) => h.id)).toEqual(['b', 'a']);
  });
});
/**
 * Provider registry — turns configuration into live `LLMPort` instances.
 *
 * The registry is the only place that knows which provider ids exist. Everything
 * upstream sees an ordered list of handles, which is exactly what the fallback
 * chain needs (whitepaper §5.3).
 * @module
 */

import type { LLMPort } from '@camelia/core';

import type { CameliaConfig, ProviderProfile } from './config/load.js';
import { usableProfiles } from './config/load.js';
import { MockProvider } from './providers/MockProvider.js';
import { OpenAICompatibleProvider } from './providers/OpenAICompatibleProvider.js';

export interface ProviderHandle {
  id: string;
  label: string;
  /** Model used unless a call pins one explicitly. */
  model: string;
  /** Models this provider advertises, for model-aware routing. */
  models: string[];
  port: LLMPort;
}

function build(profile: ProviderProfile): ProviderHandle {
  if (profile.kind === 'mock') {
    const port = new MockProvider({
      id: profile.id,
      models: profile.models,
      capabilities: profile.capabilities,
    });
    return { id: profile.id, label: profile.label, model: profile.defaultModel ?? profile.models[0] ?? 'mock-model', models: profile.models, port };
  }
  const port = new OpenAICompatibleProvider({
    id: profile.id,
    baseUrl: profile.baseUrl,
    apiKey: profile.apiKey,
    models: profile.models,
    defaultModel: profile.defaultModel,
    capabilities: profile.capabilities,
    headers: profile.headers,
  });
  return {
    id: profile.id,
    label: profile.label,
    model: profile.defaultModel ?? profile.models[0] ?? 'unknown',
    models: profile.models,
    port,
  };
}

export class ProviderRegistry {
  private readonly byId = new Map<string, ProviderHandle>();
  private readonly ordered: ProviderHandle[] = [];

  constructor(handles: ProviderHandle[]) {
    for (const handle of handles) {
      this.ordered.push(handle);
      this.byId.set(handle.id, handle);
    }
  }

  /** Build a registry from resolved config, keeping only usable providers. */
  static fromConfig(config: CameliaConfig, extraHandles: ProviderHandle[] = []): ProviderRegistry {
    const handles = usableProfiles(config).map(build);
    const merged = [...handles];
    for (const extra of extraHandles) {
      if (!merged.some((h) => h.id === extra.id)) merged.push(extra);
    }
    return new ProviderRegistry(merged);
  }

  handles(): ProviderHandle[] {
    return [...this.ordered];
  }

  get(id: string): ProviderHandle | undefined {
    return this.byId.get(id);
  }

  get size(): number {
    return this.ordered.length;
  }
}
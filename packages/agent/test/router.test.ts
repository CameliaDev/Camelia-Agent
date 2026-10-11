/**
 * Model router (whitepaper §4.8).
 *
 * Routing must be a pure, explainable function of the advertised models — a guess
 * that cannot be reproduced is worse than a documented heuristic.
 * @module
 */

import { describe, expect, it } from 'vitest';

import { ModelRouter } from '../src/ModelRouter.js';
import { MockProvider } from '../src/providers/MockProvider.js';

function router(models: string[], preferred?: { model?: string; gruntModel?: string }): ModelRouter {
  return new ModelRouter(new MockProvider({ models }), models, preferred);
}

describe('ModelRouter — decision model', () => {
  it('prefers a strong model for planning and execution', () => {
    const decision = router(['llama3.2:3b', 'qwen2.5-coder:32b']).decide();
    expect(decision.model).toBe('qwen2.5-coder:32b');
  });

  it('recognises the free-tier coder and reasoning families', () => {
    expect(router(['meta-llama/llama-3.3-70b-instruct:free']).decide().model).toBe('meta-llama/llama-3.3-70b-instruct:free');
    expect(router(['deepseek/deepseek-chat-v3.1:free']).decide().model).toBe('deepseek/deepseek-chat-v3.1:free');
    expect(router(['claude-3-5-sonnet']).decide().model).toBe('claude-3-5-sonnet');
  });

  it('falls back to the first advertised model when nothing reads as strong', () => {
    expect(router(['mystery-model-a', 'mystery-model-b']).decide().model).toBe('mystery-model-a');
  });

  it('handles a provider that advertises no models without crashing', () => {
    expect(router([]).decide().model).toBe('unknown');
  });
});

describe('ModelRouter — grunt model', () => {
  it('prefers a small model for summaries', () => {
    const decision = router(['qwen2.5-coder:32b', 'llama3.2:3b']).decide();
    expect(decision.gruntModel).toBe('llama3.2:3b');
  });

  it('recognises the mini/haiku/flash families', () => {
    expect(router(['gpt-4o', 'gpt-4o-mini']).decide().gruntModel).toBe('gpt-4o-mini');
    expect(router(['claude-3-5-sonnet', 'claude-3-5-haiku']).decide().gruntModel).toBe('claude-3-5-haiku');
  });

  it('reuses the decision model when no small model exists', () => {
    const decision = router(['qwen2.5-coder:32b']).decide();
    expect(decision.gruntModel).toBe(decision.model);
  });
});

describe('ModelRouter — explicit configuration wins', () => {
  it('honours a pinned decision and grunt model', () => {
    const decision = router(['a-3b', 'b-70b'], { model: 'b-70b', gruntModel: 'a-3b' }).decide();
    expect(decision.model).toBe('b-70b');
    expect(decision.gruntModel).toBe('a-3b');
    expect(decision.reason).toContain('pinned by config');
  });

  it('honours a pinned grunt model while still choosing the decision model', () => {
    const decision = router(['a-3b', 'b-70b'], { gruntModel: 'a-3b' }).decide();
    expect(decision.model).toBe('b-70b');
    expect(decision.gruntModel).toBe('a-3b');
  });

  it('is deterministic across repeated calls', () => {
    const r = router(['x-70b', 'y-mini']);
    expect(r.decide()).toEqual(r.decide());
  });
});

describe('ModelRouter — capability pass-through', () => {
  it('reports the underlying provider capabilities', () => {
    const r = new ModelRouter(
      new MockProvider({ capabilities: { supportsTools: false, maxContextWindow: 8_000 } }),
      ['m'],
    );
    expect(r.capabilities().supportsTools).toBe(false);
    expect(r.capabilities().maxContextWindow).toBe(8_000);
  });
});
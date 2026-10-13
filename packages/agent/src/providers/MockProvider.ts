/**
 * Scripted mock provider.
 *
 * This is not a toy: it is how the architecture is tested without burning free
 * model quota (whitepaper §9.3 — "mock Provider 先测架构正确性"). The same
 * provider powers `camelia doctor --offline` and the e2e acceptance suites.
 * @module
 */

import type {
  ChatChunk,
  ChatRequest,
  ChatFinishReason,
  JsonValue,
  LLMPort,
  LLMToolCall,
  ModelInfo,
  ProviderCapabilities,
} from '@camelia/core';
import { estimateContentTokens } from '@camelia/core';

export interface ScriptedToolCall {
  name: string;
  arguments?: JsonValue;
  id?: string;
}

export interface ScriptedTurn {
  text?: string;
  toolCalls?: ScriptedToolCall[];
  finishReason?: ChatFinishReason;
  /** When set, the provider yields an error chunk instead of a response. */
  error?: { message: string; retryable: boolean };
  promptTokens?: number;
  completionTokens?: number;
  /** Artificial latency, to exercise timeout handling. */
  delayMs?: number;
}

/** A script resolver: maps a request (and its call index) to the next turn. */
export type ScriptResolver = (request: ChatRequest, callIndex: number) => ScriptedTurn;

export type Script = ScriptedTurn[] | ScriptResolver;

export interface MockProviderOptions {
  id?: string;
  models?: string[];
  capabilities?: Partial<ProviderCapabilities>;
  script?: Script;
  /** Turn used once the script is exhausted. Defaults to a plain "done" reply. */
  fallback?: ScriptedTurn;
}

const DEFAULT_CAPABILITIES: ProviderCapabilities = {
  supportsTools: true,
  supportsJson: true,
  supportsStreaming: true,
  maxContextWindow: 32_000,
  quality: 0.5,
};

export class MockProvider implements LLMPort {
  private callIndex = 0;
  private readonly capabilitiesValue: ProviderCapabilities;

  constructor(private readonly options: MockProviderOptions = {}) {
    this.capabilitiesValue = { ...DEFAULT_CAPABILITIES, ...options.capabilities };
  }

  get id(): string {
    return this.options.id ?? 'mock';
  }

  /** How many chat calls have been served — asserted by tests. */
  get calls(): number {
    return this.callIndex;
  }

  capabilities(): ProviderCapabilities {
    return this.capabilitiesValue;
  }

  async listModels(): Promise<ModelInfo[]> {
    const models = this.options.models ?? ['mock-model'];
    return models.map((model) => ({
      id: model,
      providerId: this.id,
      label: model,
      contextWindow: this.capabilitiesValue.maxContextWindow,
      supportsTools: this.capabilitiesValue.supportsTools,
      supportsJson: this.capabilitiesValue.supportsJson,
    }));
  }

  async *chat(request: ChatRequest, signal?: AbortSignal): AsyncIterable<ChatChunk> {
    const turn = this.nextTurn(request);
    this.callIndex += 1;

    // An already-aborted signal must not wait out the artificial delay.
    if (signal?.aborted) {
      yield { type: 'error', message: 'aborted', retryable: false };
      return;
    }

    if (turn.delayMs) {
      // Resolve (never reject) on abort: the LLMPort contract reports cancellation
      // as an `error` chunk, so the consumer's `for await` must not throw.
      await new Promise<void>((resolve) => {
        const finish = (): void => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', finish);
          resolve();
        };
        const timer = setTimeout(finish, turn.delayMs);
        signal?.addEventListener('abort', finish, { once: true });
      });
    }
    if (signal?.aborted) {
      yield { type: 'error', message: 'aborted', retryable: false };
      return;
    }

    if (turn.error) {
      yield { type: 'error', message: turn.error.message, retryable: turn.error.retryable };
      return;
    }

    if (turn.text) {
      // Stream in two pieces so consumers exercise the delta path.
      const midpoint = Math.ceil(turn.text.length / 2);
      yield { type: 'text-delta', text: turn.text.slice(0, midpoint) };
      yield { type: 'text-delta', text: turn.text.slice(midpoint) };
    }

    for (const [index, call] of (turn.toolCalls ?? []).entries()) {
      const toolCall: LLMToolCall = {
        id: call.id ?? `mock-call-${this.callIndex}-${index}`,
        name: call.name,
        arguments: call.arguments ?? {},
      };
      yield { type: 'tool-call', call: toolCall };
    }

    yield {
      type: 'usage',
      promptTokens: turn.promptTokens ?? estimateRequestTokens(request),
      completionTokens: turn.completionTokens ?? 32,
    };
    yield {
      type: 'done',
      finishReason: turn.finishReason ?? (turn.toolCalls?.length ? 'tool_calls' : 'stop'),
    };
  }

  private nextTurn(request: ChatRequest): ScriptedTurn {
    const script = this.options.script;
    if (typeof script === 'function') return script(request, this.callIndex);
    if (Array.isArray(script) && this.callIndex < script.length) {
      return script[this.callIndex] ?? this.fallbackTurn();
    }
    return this.fallbackTurn();
  }

  private fallbackTurn(): ScriptedTurn {
    return this.options.fallback ?? { text: 'Mock provider: no further scripted response.' };
  }
}

function estimateRequestTokens(request: ChatRequest): number {
  return request.messages.reduce((sum, message) => sum + estimateContentTokens(message.content), 0);
}
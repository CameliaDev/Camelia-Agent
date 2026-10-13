/**
 * Fallback LLM port — the three-path chain as a single `LLMPort`.
 *
 * Whitepaper §5.3 is explicit that this is *not* a retry loop: a provider failure
 * advances a cursor that changes the provider used for every subsequent call, so
 * the task state machine's next decision is made against the new provider's
 * capabilities. That is what makes "architecture compensate for the model" real
 * rather than aspirational.
 * @module
 */

import type {
  ChatChunk,
  ChatRequest,
  LLMPort,
  ModelInfo,
  ProviderCapabilities,
} from '@camelia/core';

import type { ProviderHandle } from './ProviderRegistry.js';

export interface FallbackHooks {
  /** Called once the active provider is known (initial selection). */
  onSelect?: (handle: ProviderHandle, reason: string) => void;
  /** Called when the chain advances past a failing provider. */
  onFallback?: (from: ProviderHandle, to: ProviderHandle | undefined, reason: string, depth: number) => void;
  /** Called when every provider has been exhausted. */
  onExhausted?: (reason: string) => void;
}

export class FallbackLLMPort implements LLMPort {
  private index = 0;

  constructor(
    private handles: ProviderHandle[],
    private readonly hooks: FallbackHooks = {},
  ) {
    if (handles.length === 0) {
      throw new Error('FallbackLLMPort requires at least one provider');
    }
    this.hooks.onSelect?.(this.active, 'initial selection');
  }

  get id(): string {
    return `fallback(${this.handles.map((h) => h.id).join(' -> ')})`;
  }

  /** The provider currently answering. */
  get active(): ProviderHandle {
    return this.handles[Math.min(this.index, this.handles.length - 1)]!;
  }

  /** How deep into the chain we have fallen. 0 means the primary is healthy. */
  get depth(): number {
    return this.index;
  }

  /** Exposed for `camelia provider status`. */
  get chain(): { id: string; active: boolean }[] {
    return this.handles.map((handle, i) => ({ id: handle.id, active: i === this.index }));
  }

  /**
   * User-initiated mid-session switch. Moves the cursor to the handle whose id
   * matches; returns false when the id is not in the chain. Subsequent calls use
   * the new cursor (and fall forward from it on failure).
   */
  switchTo(providerId: string): boolean {
    const idx = this.handles.findIndex((h) => h.id === providerId);
    if (idx < 0) return false;
    this.index = idx;
    return true;
  }

  /**
   * Swap the chain after config is re-read. The same port object stays wired into
   * ChatLoop, so the next turn uses the new clients without spawning a process.
   */
  replaceHandles(handles: ProviderHandle[]): void {
    if (handles.length === 0) throw new Error('FallbackLLMPort requires at least one provider');
    this.handles = handles;
    this.index = 0;
  }

  /**
   * Make `model` the one this provider will send. A picker choice that was not in the
   * list captured at spawn must not be rewritten back to `handle.model`.
   */
  pinModel(model: string): void {
    const trimmed = model.trim();
    if (!trimmed) return;
    const handle = this.active;
    if (!handle.models.includes(trimmed)) handle.models = [...handle.models, trimmed];
    handle.model = trimmed;
  }

  capabilities(): ProviderCapabilities {
    return this.active.port.capabilities();
  }

  async listModels(): Promise<ModelInfo[]> {
    return this.active.port.listModels();
  }

  async *chat(request: ChatRequest, signal?: AbortSignal): AsyncIterable<ChatChunk> {
    for (let i = this.index; i < this.handles.length; i += 1) {
      const handle = this.handles[i]!;
      this.index = i;

      // Resolve the model against *this* provider so a pinned id from a previous
      // provider cannot be sent to one that does not know it.
      const model = handle.models.includes(request.model) ? request.model : handle.model;
      let yielded = false;
      let failure: ChatChunk & { type: 'error' } | undefined;

      try {
        for await (const chunk of handle.port.chat({ ...request, model }, signal)) {
          if (chunk.type === 'error') {
            failure = chunk;
            break;
          }
          yielded = true;
          yield chunk;
        }
      } catch (error) {
        failure = {
          type: 'error',
          message: error instanceof Error ? error.message : String(error),
          retryable: true,
        };
      }

      if (!failure) return;

      // Partial output cannot be safely retried on another provider: the caller
      // has already observed a delta. Surface the failure instead.
      if (yielded) {
        yield failure;
        return;
      }

      // A fatal provider error (bad request, auth) will not be fixed by moving on.
      if (!failure.retryable) {
        yield failure;
        return;
      }

      const next = this.handles[i + 1];
      if (!next) {
        // Chain exhausted. Normalise to non-retryable: there is nothing left to
        // try, and a caller that honours `retryable` would otherwise spin against
        // a chain with no live provider.
        this.hooks.onExhausted?.(failure.message);
        yield { ...failure, retryable: false };
        return;
      }

      this.hooks.onFallback?.(handle, next, failure.message, i + 1);
      this.index = i + 1;
    }
  }
}
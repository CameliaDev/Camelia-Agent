/**
 * Model gateway — the harness's single, guarded door to a language model.
 *
 * Every planner/executor/sub-agent call goes through here so that retry policy,
 * token accounting, tracing and capability adaptation are applied in exactly one
 * place (whitepaper §3.10, §5.2, §5.3).
 *
 * The gateway deliberately knows nothing about *which* provider answered: it sees
 * an `LLMPort`. The agent layer composes the three-path fallback behind that port.
 * @module
 */

import type {
  ChatChunk,
  ChatFinishReason,
  LLMMessage,
  LLMToolCall,
  LLMToolSchema,
  JsonValue,
  ProviderCapabilities,
} from '@camelia/core';

import type { RunContext } from '../context/RunContext.js';
import { runMeta } from '../context/RunContext.js';
import { isRetryableError } from '../tools/types.js';

export interface ModelCallInput {
  /** Model id override. Defaults to `ctx.model`. */
  model?: string;
  system: string;
  messages: LLMMessage[];
  tools?: LLMToolSchema[];
  responseFormat?: 'text' | 'json';
  maxTokens?: number;
  temperature?: number;
  /** Short label used for metrics and spans, e.g. `plan`, `execute`, `summarize`. */
  purpose: string;
}

export interface ModelCallResult {
  text: string;
  toolCalls: LLMToolCall[];
  finishReason: ChatFinishReason;
  usage: { promptTokens: number; completionTokens: number };
  /** 1 means the first attempt succeeded. */
  attempts: number;
  /** True when tools were stripped because the provider cannot use them. */
  toolsSuppressed: boolean;
}

/** Raised when a model call cannot be completed after every retry. */
export class ModelCallError extends Error {
  constructor(
    message: string,
    readonly purpose: string,
    readonly attempts: number,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'ModelCallError';
  }
}

/** Coerce a provider's tool arguments (object or JSON string) into a JSON value. */
export function parseToolArguments(args: JsonValue | string): JsonValue {
  if (typeof args !== 'string') return args;
  const trimmed = args.trim();
  if (trimmed === '') return {};
  try {
    return JSON.parse(trimmed) as JsonValue;
  } catch {
    // A weak model may emit a bare string or malformed JSON. Surface it verbatim
    // so the schema validator can reject it with a useful message.
    return { __raw: args };
  }
}

export class ModelGateway {
  private readonly totals = { promptTokens: 0, completionTokens: 0, calls: 0 };
  /**
   * Every call's prompt payload, for the offline run record (Iteration 24).
   *
   * The full `system` is what was actually sent to the model — including the
   * profile, workspace listing and tool names the planner injected — so a phase
   * check can reconstruct what a run saw without a live model. Recorded on entry
   * (success and failure alike), so a failed call is replayable too.
   */
  readonly promptLog: Array<{ purpose: string; model: string; system: string }> = [];

  constructor(private readonly ctx: RunContext) {}

  capabilities(): ProviderCapabilities {
    return this.ctx.ports.llm.capabilities();
  }

  /** Cumulative usage for this run — the basis of the task cost report. */
  get usage(): { promptTokens: number; completionTokens: number; calls: number } {
    return { ...this.totals };
  }

  /**
   * Choose the model for one call, by what the call is *for*.
   *
   * This is the point of the `gruntModel` setting, which until now was carried
   * through `RunContext` and never read — every call went to the same model, so
   * "multi-model collaboration" was configured but not wired.
   *
   * Routing is by purpose rather than by model name:
   *
   * - `clarify` restates a request in the agent's own words. Mechanical, and a
   *   weak model does it acceptably, so it goes to the cheap model.
   * - `plan` and `replan` decide the shape of the work. Wrong here costs many
   *   downstream steps, so they always get the decision model.
   * - `execute` acts through tools. Kept on the decision model by default: with a
   *   weak model, tool-call formatting is the fragile part (measured: qwen needs
   *   the text-call protocol), and putting it on a weaker model makes that worse.
   *
   * An explicit `input.model` always wins — the caller knows something this
   * heuristic does not.
   */
  private modelFor(input: ModelCallInput): string {
    if (input.model) return input.model;
    const decision = this.ctx.model;
    const grunt = this.ctx.gruntModel || decision;
    // Identical models collapse to the decision one so traces do not imply a
    // distinction that does not exist.
    if (grunt === decision) return decision;

    switch (input.purpose) {
      case 'clarify':
      case 'summarise':
      case 'compact':
        return grunt;
      case 'plan':
      case 'replan':
      case 'execute':
      default:
        return decision;
    }
  }

  /**
   * Call the model, retrying transient failures with exponential backoff.
   *
   * Never returns a partial result: either a complete `ModelCallResult` or a
   * `ModelCallError`. Callers classify that error via `ErrorRecovery`.
   */
  async call(input: ModelCallInput): Promise<ModelCallResult> {
    const caps = this.capabilities();
    const model = this.modelFor(input);
    this.promptLog.push({ purpose: input.purpose, model, system: input.system });
    const toolsSuppressed = Boolean(input.tools && !caps.supportsTools);
    const tools = toolsSuppressed ? undefined : input.tools;
    const maxAttempts = Math.max(1, this.ctx.config.maxRetries);
    const meta = runMeta(this.ctx);

    let attempt = 0;
    let lastError = '';
    let lastRetryable = true;

    while (attempt < maxAttempts) {
      attempt += 1;
      const span = this.ctx.infra.tracer.startSpan(`model.${input.purpose}`, {
        traceId: this.ctx.traceId,
        attributes: { model, attempt, purpose: input.purpose },
      });
      try {
        const result = await this.runOnce(input, model, tools, meta);
        if (result.finishReason === 'error') {
          throw new Error(result.errorMessage || 'provider returned an error chunk');
        }
        this.ctx.infra.tracer.end(span, 'ok', {
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
          toolCalls: result.toolCalls.length,
        });
        this.ctx.infra.metrics.inc('model.calls', { purpose: input.purpose, model });
        this.totals.calls += 1;
        this.totals.promptTokens += result.promptTokens;
        this.totals.completionTokens += result.completionTokens;
        this.ctx.infra.metrics.observe('model.prompt_tokens', result.promptTokens, { purpose: input.purpose });
        this.ctx.infra.metrics.observe('model.completion_tokens', result.completionTokens, {
          purpose: input.purpose,
        });
        return {
          text: result.text,
          toolCalls: result.toolCalls,
          finishReason: result.finishReason,
          usage: { promptTokens: result.promptTokens, completionTokens: result.completionTokens },
          attempts: attempt,
          toolsSuppressed,
        };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        lastRetryable = isRetryableError(lastError) || attempt < maxAttempts;
        this.ctx.infra.tracer.end(span, 'error', { error: lastError, attempt });
        this.ctx.infra.metrics.inc('model.errors', { purpose: input.purpose, model });
        this.ctx.infra.logger.warn('model call failed', {
          purpose: input.purpose,
          attempt,
          error: lastError,
        });
        if (!isRetryableError(lastError)) break;
        if (attempt < maxAttempts) {
          await this.ctx.ports.clock.sleep(backoffMs(attempt));
        }
      }
    }

    const decision = this.ctx.model;
    if (model !== decision && isMissingModel(lastError)) {
      this.ctx.infra.logger.warn('named model is not installed; using the decision model', {
        model,
        decision,
        purpose: input.purpose,
      });
      return this.call({ ...input, model: decision });
    }

    throw new ModelCallError(lastError, input.purpose, attempt, lastRetryable);
  }

  private async runOnce(
    input: ModelCallInput,
    model: string,
    tools: LLMToolSchema[] | undefined,
    meta: ReturnType<typeof runMeta>,
  ): Promise<{
    text: string;
    toolCalls: LLMToolCall[];
    finishReason: ChatFinishReason;
    promptTokens: number;
    completionTokens: number;
    errorMessage: string;
  }> {
    const stream = this.ctx.ports.llm.chat(
      {
        model,
        messages: [{ role: 'system', content: input.system }, ...input.messages],
        tools,
        temperature: input.temperature ?? this.ctx.config.temperature,
        maxTokens: input.maxTokens,
        responseFormat: input.responseFormat,
      },
      this.ctx.signal,
    );

    let text = '';
    const toolCalls: LLMToolCall[] = [];
    let finishReason: ChatFinishReason = 'stop';
    let promptTokens = 0;
    let completionTokens = 0;
    let errorMessage = '';

    for await (const chunk of stream) {
      this.observeChunk(chunk, meta);
      switch (chunk.type) {
        case 'text-delta':
          text += chunk.text;
          break;
        case 'tool-call':
          toolCalls.push(chunk.call);
          break;
        case 'usage':
          promptTokens = chunk.promptTokens;
          completionTokens = chunk.completionTokens;
          break;
        case 'done':
          finishReason = chunk.finishReason;
          break;
        case 'error':
          errorMessage = chunk.message;
          finishReason = 'error';
          break;
      }
    }

    return { text, toolCalls, finishReason, promptTokens, completionTokens, errorMessage };
  }

  /** Stream a token delta to the bus so the UI can render live output. */
  private observeChunk(chunk: ChatChunk, meta: ReturnType<typeof runMeta>): void {
    if (chunk.type !== 'text-delta') return;
    this.ctx.infra.bus.emit('log', { level: 'debug', message: chunk.text, meta: { stream: true } }, meta);
  }
}

/** Exponential backoff: 200ms, 400ms, 800ms ... */
export function backoffMs(attempt: number, base = 200): number {
  return base * 2 ** Math.max(0, attempt - 1);
}

/** The provider advertised a model it cannot run. DNS ENOTFOUND is a different failure. */
function isMissingModel(message: string): boolean {
  return /not[_ ]found|\b404\b/i.test(message);
}
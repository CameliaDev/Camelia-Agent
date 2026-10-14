/**
 * OpenAI-compatible provider.
 *
 * One implementation covers all three free paths — OpenCode Zen, OpenRouter and
 * Ollama — because they all speak the OpenAI `/chat/completions` shape. That is a
 * deliberate architectural choice: three providers we can swap by config, not
 * three code paths we have to maintain (whitepaper §5.3).
 * @module
 */

import type {
  ChatChunk,
  ChatRequest,
  LLMPort,
  LLMToolCall,
  ModelCapabilitySpec,
  ModelInfo,
  ProviderCapabilities,
} from '@camelia/core';
import { resolveModelInfo } from '@camelia/core';

export interface OpenAICompatibleConfig {
  /** Stable provider id, e.g. `openrouter`. */
  id: string;
  /** Base URL without the trailing `/chat/completions`. */
  baseUrl: string;
  /** Bearer token. Omitted for Ollama. */
  apiKey?: string;
  /** Advertised models. */
  models: string[];
  /** Default model when the request does not pin one. */
  defaultModel?: string;
  capabilities?: Partial<ProviderCapabilities>;
  /** Per-model capability overrides from config. */
  modelCapabilities?: Record<string, ModelCapabilitySpec>;
  /** Extra headers (e.g. OpenRouter's `HTTP-Referer`). */
  headers?: Record<string, string>;
  /** Request timeout in ms. */
  timeoutMs?: number;
}

const DEFAULT_CAPABILITIES: ProviderCapabilities = {
  supportsTools: true,
  supportsJson: true,
  supportsStreaming: true,
  maxContextWindow: 128_000,
  quality: 0.6,
};

interface StreamDelta {
  role?: string;
  content?: string | null;
  /** DeepSeek / Qwen compatible reasoning channel. Not the answer. */
  reasoning_content?: string | null;
  reasoning?: string | null;
  tool_calls?: {
    index: number;
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  }[];
}

interface StreamEvent {
  choices?: { delta?: StreamDelta; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string; type?: string };
}

export class OpenAICompatibleProvider implements LLMPort {
  private readonly capabilitiesValue: ProviderCapabilities;

  constructor(private readonly config: OpenAICompatibleConfig) {
    this.capabilitiesValue = { ...DEFAULT_CAPABILITIES, ...config.capabilities };
  }

  get id(): string {
    return this.config.id;
  }

  get defaultModel(): string {
    return this.config.defaultModel ?? this.config.models[0] ?? 'unknown';
  }

  capabilities(): ProviderCapabilities {
    return this.capabilitiesValue;
  }

  async listModels(): Promise<ModelInfo[]> {
    return this.config.models.map((model) =>
      resolveModelInfo({
        id: model,
        providerId: this.config.id,
        providerCaps: this.capabilitiesValue,
        override: this.config.modelCapabilities?.[model],
      }),
    );
  }

  async *chat(request: ChatRequest, signal?: AbortSignal): AsyncIterable<ChatChunk> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 120_000);
    const onAbort = (): void => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      const response = await fetch(`${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {}),
          ...(this.config.headers ?? {}),
        },
        body: JSON.stringify(this.buildBody(request)),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const detail = await safeText(response);
        yield {
          type: 'error',
          message: `HTTP ${response.status} from ${this.config.id}: ${detail.slice(0, 400)}`,
          retryable: response.status === 429 || response.status >= 500,
        };
        return;
      }

      yield* this.parseStream(response.body);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const aborted = controller.signal.aborted && !signal?.aborted;
      yield {
        type: 'error',
        message: aborted ? `Request to ${this.config.id} timed out` : message,
        retryable: true,
      };
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  /** Public for testing: the exact request body we send. */
  buildBody(request: ChatRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: request.model || this.defaultModel,
      messages: request.messages.map((message) => ({
        role: message.role,
        content: message.content,
        ...(message.name ? { name: message.name } : {}),
        ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
        ...(message.toolCalls
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: 'function',
                function: {
                  name: call.name,
                  arguments: typeof call.arguments === 'string' ? call.arguments : JSON.stringify(call.arguments),
                },
              })),
            }
          : {}),
      })),
      stream: true,
      stream_options: { include_usage: true },
    };
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;
    if (request.tools?.length && this.capabilitiesValue.supportsTools) {
      body.tools = request.tools.map((tool) => ({
        type: 'function',
        function: { name: tool.name, description: tool.description, parameters: tool.parameters },
      }));
    }
    if (request.responseFormat === 'json' && this.capabilitiesValue.supportsJson) {
      body.response_format = { type: 'json_object' };
    }
    return body;
  }

  /** Parse an OpenAI-style SSE body into Camelia chunks. */
  private async *parseStream(body: ReadableStream<Uint8Array>): AsyncIterable<ChatChunk> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finishReason: ChatChunk & { type: 'done' } = { type: 'done', finishReason: 'stop' };
    const toolAccumulator = new Map<number, { id: string; name: string; args: string }>();
    let sawUsage = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') continue;

        let event: StreamEvent;
        try {
          event = JSON.parse(payload) as StreamEvent;
        } catch {
          continue;
        }

        if (event.error) {
          yield { type: 'error', message: event.error.message ?? 'provider error', retryable: false };
          continue;
        }

        const choice = event.choices?.[0];
        const delta = choice?.delta;
        const reasoning = delta?.reasoning_content ?? delta?.reasoning;
        if (typeof reasoning === 'string' && reasoning) yield { type: 'reasoning-delta', text: reasoning };
        if (delta?.content) yield { type: 'text-delta', text: delta.content };

        for (const call of delta?.tool_calls ?? []) {
          const existing = toolAccumulator.get(call.index) ?? { id: '', name: '', args: '' };
          if (call.id) existing.id = call.id;
          if (call.function?.name) existing.name += call.function.name;
          if (call.function?.arguments) existing.args += call.function.arguments;
          toolAccumulator.set(call.index, existing);
        }

        if (event.usage && (event.usage.prompt_tokens !== undefined || event.usage.completion_tokens !== undefined)) {
          sawUsage = true;
          yield {
            type: 'usage',
            promptTokens: event.usage.prompt_tokens ?? 0,
            completionTokens: event.usage.completion_tokens ?? 0,
          };
        }

        if (choice?.finish_reason) {
          finishReason = {
            type: 'done',
            finishReason: mapFinishReason(choice.finish_reason),
          };
        }
      }
    }

    for (const [, call] of [...toolAccumulator.entries()].sort((a, b) => a[0] - b[0])) {
      const toolCall: LLMToolCall = {
        id: call.id || `call_${Math.random().toString(36).slice(2, 10)}`,
        name: call.name,
        arguments: call.args || '{}',
      };
      yield { type: 'tool-call', call: toolCall };
    }

    if (!sawUsage) {
      // Ollama and some gateways omit usage on streamed responses; report zero
      // rather than fabricating a number.
      yield { type: 'usage', promptTokens: 0, completionTokens: 0 };
    }
    yield finishReason;
  }
}

function mapFinishReason(reason: string): 'stop' | 'tool_calls' | 'length' | 'error' {
  switch (reason) {
    case 'tool_calls':
    case 'function_call':
      return 'tool_calls';
    case 'length':
      return 'length';
    case 'stop':
      return 'stop';
    default:
      return 'error';
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}
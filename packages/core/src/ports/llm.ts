/**
 * LLM port — the boundary between Camelia and any model provider.
 *
 * Providers are injected, never imported by the harness. This is what makes
 * the three-path fallback chain (OpenCode Zen -> OpenRouter -> Ollama) and the
 * mock provider used in tests possible (whitepaper §5.3).
 *
 * `LLMMessage.content` accepts either a plain string (legacy / non-vision turns)
 * or an OpenAI-compatible multimodal part list so vision models on Aliyun /
 * OpenRouter / OpenAI can see pasted images without a second code path.
 * @module
 */

import type { JsonSchema, JsonValue } from '../types/common.js';
import type { ModelInfo, ProviderCapabilities } from '../types/domain.js';
import { estimateTokens } from '../utils/tokens.js';

export interface LLMToolCall {
  id: string;
  name: string;
  /** Parsed arguments when the provider returns valid JSON; raw string otherwise. */
  arguments: JsonValue | string;
}

/** OpenAI-compatible text part. */
export interface LLMTextPart {
  type: 'text';
  text: string;
}

/** OpenAI-compatible image part (`data:` URL or https). */
export interface LLMImageUrlPart {
  type: 'image_url';
  image_url: {
    url: string;
    detail?: 'auto' | 'low' | 'high';
  };
}

export type LLMContentPart = LLMTextPart | LLMImageUrlPart;

/** Plain string or multimodal parts — both are legal on the wire. */
export type LLMContent = string | LLMContentPart[];

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: LLMContent;
  /** Tool name, required for `role: 'tool'`. */
  name?: string;
  /** Correlates a tool result with the assistant's tool call. */
  toolCallId?: string;
  /** Present on assistant messages that request tools. */
  toolCalls?: LLMToolCall[];
}

/** Flatten multimodal content to plain text (images become a short marker). */
export function llmContentText(content: LLMContent): string {
  if (typeof content === 'string') return content;
  const chunks: string[] = [];
  for (const part of content) {
    if (part.type === 'text') chunks.push(part.text);
    else chunks.push('[image]');
  }
  return chunks.join('\n');
}

/** Rough token estimate: text by chars; each image counts as ~1k tokens. */
export function estimateContentTokens(content: LLMContent): number {
  if (typeof content === 'string') return estimateTokens(content);
  let total = 0;
  for (const part of content) {
    if (part.type === 'text') total += estimateTokens(part.text);
    else total += 1024;
  }
  return total;
}

export interface LLMToolSchema {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export interface ChatRequest {
  model: string;
  messages: LLMMessage[];
  tools?: LLMToolSchema[];
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'text' | 'json';
}

export type ChatFinishReason = 'stop' | 'tool_calls' | 'length' | 'error';

export type ChatChunk =
  | { type: 'text-delta'; text: string }
  | { type: 'tool-call'; call: LLMToolCall }
  | { type: 'usage'; promptTokens: number; completionTokens: number }
  | { type: 'done'; finishReason: ChatFinishReason }
  | { type: 'error'; message: string; retryable: boolean };

/** Fully materialised response — what `collectChat` produces. */
export interface LLMResponse {
  text: string;
  toolCalls: LLMToolCall[];
  finishReason: ChatFinishReason;
  promptTokens: number;
  completionTokens: number;
  /** Raw chunks, for observability/replay. */
  chunks: ChatChunk[];
}

export interface LLMPort {
  readonly id: string;
  /** Static capability profile, used by ModelRouter for granularity + routing. */
  capabilities(): ProviderCapabilities;
  listModels(): Promise<ModelInfo[]>;
  /** Must be streaming. Non-streaming providers wrap a single chunk. */
  chat(request: ChatRequest, signal?: AbortSignal): AsyncIterable<ChatChunk>;
}

/** Drain a chat stream into a single response. */
export async function collectChat(stream: AsyncIterable<ChatChunk>): Promise<LLMResponse> {
  let text = '';
  const toolCalls: LLMToolCall[] = [];
  const chunks: ChatChunk[] = [];
  let finishReason: ChatFinishReason = 'stop';
  let promptTokens = 0;
  let completionTokens = 0;

  for await (const chunk of stream) {
    chunks.push(chunk);
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
        finishReason = 'error';
        break;
    }
  }

  return { text, toolCalls, finishReason, promptTokens, completionTokens, chunks };
}

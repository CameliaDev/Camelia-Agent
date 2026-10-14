/**
 * Drain one non-streaming model turn. Work delegation uses this for the
 * coordinator and for each gated sub-AI.
 * @module
 */

import type { ChatRequest, LLMPort, LLMToolCall } from '@camelia/core';

export interface CollectedTurn {
  text: string;
  calls: LLMToolCall[];
}

export async function collectLLMTurn(port: LLMPort, request: ChatRequest, signal?: AbortSignal): Promise<CollectedTurn> {
  let text = '';
  const calls: LLMToolCall[] = [];
  for await (const chunk of port.chat(request, signal)) {
    if (signal?.aborted) break;
    if (chunk.type === 'text-delta') text += chunk.text;
    else if (chunk.type === 'tool-call') calls.push(chunk.call);
    else if (chunk.type === 'error') throw new Error(chunk.message);
  }
  return { text, calls };
}

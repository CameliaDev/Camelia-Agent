import { describe, expect, it } from 'vitest';

import { collectChat, systemClock } from '../src/index.js';
import type { ChatChunk } from '../src/index.js';

async function* fromChunks(chunks: ChatChunk[]): AsyncIterable<ChatChunk> {
  for (const chunk of chunks) yield chunk;
}

describe('collectChat', () => {
  it('accumulates text, tool calls, usage and finish reason', async () => {
    const response = await collectChat(
      fromChunks([
        { type: 'text-delta', text: 'hel' },
        { type: 'text-delta', text: 'lo' },
        { type: 'tool-call', call: { id: 'c1', name: 'fs.read', arguments: { path: 'a.ts' } } },
        { type: 'usage', promptTokens: 10, completionTokens: 5 },
        { type: 'done', finishReason: 'tool_calls' },
      ]),
    );

    expect(response.text).toBe('hello');
    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls[0]?.name).toBe('fs.read');
    expect(response.promptTokens).toBe(10);
    expect(response.completionTokens).toBe(5);
    expect(response.finishReason).toBe('tool_calls');
    expect(response.chunks).toHaveLength(5);
  });

  it('treats an error chunk as an error finish reason', async () => {
    const response = await collectChat(fromChunks([{ type: 'error', message: 'boom', retryable: true }]));
    expect(response.finishReason).toBe('error');
  });

  it('defaults to stop on an empty stream', async () => {
    const response = await collectChat(fromChunks([]));
    expect(response.finishReason).toBe('stop');
    expect(response.text).toBe('');
    expect(response.toolCalls).toEqual([]);
  });
});

describe('systemClock', () => {
  it('now() returns epoch milliseconds', () => {
    expect(systemClock.now()).toBeGreaterThan(1_600_000_000_000);
  });

  it('sleep() resolves', async () => {
    await expect(systemClock.sleep(1)).resolves.toBeUndefined();
  });
});